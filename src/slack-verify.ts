import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_SKEW_SEC = 60 * 5; // 5분

/**
 * Slack Signing Secret으로 요청 서명을 검증한다.
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackSignature(opts: {
  signingSecret: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  nowSec?: number;
}): boolean {
  const { signingSecret, signature, timestamp, rawBody } = opts;
  if (!signature || !timestamp) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;

  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MAX_SKEW_SEC) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const digest = createHmac("sha256", signingSecret).update(base, "utf8").digest("hex");
  const expected = `v0=${digest}`;

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
