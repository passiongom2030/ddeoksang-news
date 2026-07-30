import type { IncomingMessage } from "node:http";
import { fetchAllQuotes } from "../src/yahoo.js";
import { formatTrendMessage } from "../src/format.js";
import { verifySlackSignature } from "../src/slack-verify.js";

/** Vercel Node serverless + 로컬 http 호환 최소 타입 */
interface SlackTrendRequest extends IncomingMessage {
  method?: string;
  headers: IncomingMessage["headers"];
}

interface SlackTrendResponse {
  status(code: number): SlackTrendResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  send(body: string): void;
}

export const config = {
  api: {
    bodyParser: false,
  },
};

async function readRawBody(req: SlackTrendRequest): Promise<string> {
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

async function buildTrendAndReply(responseUrl: string): Promise<void> {
  try {
    const rows = await fetchAllQuotes();
    const text = formatTrendMessage(rows);
    await postDelayedReply(responseUrl, text);
  } catch (err) {
    console.error("trend build failed:", err);
    await postDelayedReply(
      responseUrl,
      "⚠️ 동향 조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
    );
  }
}

/**
 * Slack slash command `/동향` 핸들러.
 * 즉시 ack → 야후 조회 후 response_url로 최종 메시지.
 * (응답 flush 후에도 handler Promise를 await 해서 런타임이 조기 종료되지 않게 함)
 */
export default async function handler(req: SlackTrendRequest, res: SlackTrendResponse) {
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
  if (!responseUrl) {
    return res.status(400).send("Missing response_url");
  }

  // 조회는 ack 이후에 — 핸들러 종료 전까지 await로 유지
  const work = buildTrendAndReply(responseUrl);

  res.status(200).json({
    response_type: "ephemeral",
    text: "📊 동향 조회 중...",
  });

  await work;
}
