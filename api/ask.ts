import type { IncomingMessage } from "node:http";
import { askAboutStocks } from "../src/ask.js";
import { verifySlackSignature } from "../src/slack-verify.js";

/** Vercel Node serverless + 로컬 http 호환 최소 타입 */
interface SlackAskRequest extends IncomingMessage {
  method?: string;
  headers: IncomingMessage["headers"];
}

interface SlackAskResponse {
  status(code: number): SlackAskResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: SlackAskRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function postDelayedReply(responseUrl: string, text: string): Promise<void> {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        replace_original: true,
        text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`response_url POST failed: ${res.status} ${body}`);
    }
  } catch (err) {
    console.error("response_url POST error:", err);
  }
}

async function buildAnswerAndReply(question: string, responseUrl: string): Promise<void> {
  try {
    const answer = await askAboutStocks(question);
    await postDelayedReply(responseUrl, answer);
  } catch (err) {
    console.error("ask failed:", err);
    await postDelayedReply(
      responseUrl,
      "⚠️ 답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}

/**
 * Slack slash command `/주식` 핸들러.
 * 즉시 ack → 워치리스트 데이터 조회 + Gemini 답변 생성 → response_url로 최종 메시지.
 */
export default async function handler(req: SlackAskRequest, res: SlackAskResponse) {
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

  const params = new URLSearchParams(rawBody);
  const responseUrl = params.get("response_url");
  const question = params.get("text") ?? "";
  if (!responseUrl) {
    return res.status(400).send("Missing response_url");
  }

  // 답변 생성은 ack 이후에 — 핸들러 종료 전까지 await로 유지
  const work = buildAnswerAndReply(question, responseUrl);

  res.status(200).json({
    response_type: "ephemeral",
    text: "🤔 조회 중...",
  });

  await work;
}
