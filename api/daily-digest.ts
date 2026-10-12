import type { IncomingMessage } from "node:http";
import { fetchAllQuotes } from "../src/yahoo.js";
import { formatTrendMessage } from "../src/format.js";
import { postToSlack } from "../src/slack.js";

interface DigestRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
}

interface DigestResponse {
  status(code: number): DigestResponse;
  json(body: unknown): void;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 장마감 후 관심종목 요약 — Vercel Cron(vercel.json crons)이 호출한다.
 * GitHub Actions schedule이 몇 시간씩 밀리는 문제(2026-09 실측)를 피하려고 이쪽으로 이전.
 * 인증: Vercel Cron이 보내는 `Authorization: Bearer $CRON_SECRET` 또는 수동 테스트용 ?key=.
 * ?dry=1 이면 Slack에 보내지 않고 메시지만 반환.
 */
export default async function handler(req: DigestRequest, res: DigestResponse) {
  const cronSecret = process.env.CRON_SECRET;
  const manualKey = process.env.INTRADAY_CRON_SECRET;
  const bearer = req.headers.authorization;
  const authed =
    (cronSecret && bearer === `Bearer ${cronSecret}`) ||
    (manualKey && first(req.query?.key) === manualKey);
  if (!authed) return res.status(401).json({ error: "unauthorized" });

  const session = first(req.query?.session) === "us" ? "us" : "kr";
  const title = session === "us" ? "📊 *미국장 마감 요약*" : "📊 *국내장 마감 요약*";
  const dry = first(req.query?.dry) === "1";

  const rows = await fetchAllQuotes();
  const message = formatTrendMessage(rows, title);

  if (!dry) {
    await postToSlack(message, { username: "stock-news-bot", icon_emoji: ":bar_chart:" });
  }
  return res.status(200).json({ posted: !dry, session, message });
}
