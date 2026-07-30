import type { IncomingMessage } from "node:http";
import { verifySlackSignature } from "../src/slack-verify.js";
import { getBotUserId, fetchThreadReplies, postThreadReply } from "../src/slack-api.js";
import { answerInThread } from "../src/thread-ask.js";

interface SlackEventsRequest extends IncomingMessage {
  method?: string;
  headers: IncomingMessage["headers"];
}

interface SlackEventsResponse {
  status(code: number): SlackEventsResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: SlackEventsRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

interface SlackEvent {
  type: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  text?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
}

/** 이 스레드에 우리 봇이 이미 참여 중인지 확인 (별도 DB 없이 매번 Slack에 물어봄). */
async function botIsInThread(channel: string, threadTs: string, botUserId: string): Promise<boolean> {
  const messages = await fetchThreadReplies(channel, threadTs);
  return messages.some((m) => m.bot_id || m.user === botUserId);
}

async function handleEvent(event: SlackEvent): Promise<void> {
  console.log("[events] received:", event.type, "channel=", event.channel, "bot_id=", event.bot_id);

  if (event.bot_id) {
    console.log("[events] ignoring bot-originated message");
    return;
  }

  const botUserId = await getBotUserId();
  console.log("[events] botUserId=", botUserId);
  const channel = event.channel;
  if (!channel) {
    console.log("[events] no channel on event, ignoring");
    return;
  }

  if (event.type === "app_mention") {
    const threadTs = event.thread_ts ?? event.ts!;
    console.log("[events] app_mention -> answering in thread", threadTs);
    const answer = await answerInThread(channel, threadTs, botUserId);
    console.log("[events] got answer, posting:", answer.slice(0, 80));
    await postThreadReply(channel, threadTs, answer);
    console.log("[events] posted reply successfully");
    return;
  }

  if (event.type === "message" && event.thread_ts && !event.subtype) {
    console.log("[events] thread reply -> checking if our thread", event.thread_ts);
    const isOurThread = await botIsInThread(channel, event.thread_ts, botUserId);
    if (!isOurThread) {
      console.log("[events] not our thread, ignoring");
      return;
    }
    const answer = await answerInThread(channel, event.thread_ts, botUserId);
    console.log("[events] got answer, posting:", answer.slice(0, 80));
    await postThreadReply(channel, event.thread_ts, answer);
    console.log("[events] posted reply successfully");
  } else {
    console.log("[events] event did not match any handler, ignoring");
  }
}

export default async function handler(req: SlackEventsRequest, res: SlackEventsResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).send("Method Not Allowed");
  }

  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret) {
    console.error("SLACK_SIGNING_SECRET is not set");
    return res.status(500).send("Server misconfigured");
  }

  let rawBody: string;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error("failed to read body:", err);
    return res.status(400).send("Bad Request");
  }

  const signature = req.headers["x-slack-signature"];
  const timestamp = req.headers["x-slack-request-timestamp"];
  const sig = Array.isArray(signature) ? signature[0] : signature;
  const ts = Array.isArray(timestamp) ? timestamp[0] : timestamp;

  if (!verifySlackSignature({ signingSecret, signature: sig, timestamp: ts, rawBody })) {
    return res.status(401).send("Invalid signature");
  }

  const body = JSON.parse(rawBody) as { type: string; challenge?: string; event?: SlackEvent };
  console.log("[events] body.type=", body.type, "retry=", req.headers["x-slack-retry-num"]);

  // 최초 Event Subscriptions 연결 시 1회 검증
  if (body.type === "url_verification") {
    return res.status(200).json({ challenge: body.challenge });
  }

  if (body.type !== "event_callback" || !body.event) {
    return res.status(200).send("ignored");
  }

  // Slack은 3초 내 미응답 시 재시도(X-Slack-Retry-Num) — 중복 응답 방지 위해 재시도는 무시
  if (req.headers["x-slack-retry-num"]) {
    return res.status(200).send("retry ignored");
  }

  // res.send() 이후에도 함수가 살아있게 await로 유지 — 혹시 런타임이 응답 후 바로
  // 종료시키는 경우를 대비해 처리 자체를 먼저 끝내고 나서 응답한다 (3초 내에 끝나길 기대).
  try {
    await handleEvent(body.event);
  } catch (err) {
    console.error("event handling failed:", err);
  }

  res.status(200).send("");
}
