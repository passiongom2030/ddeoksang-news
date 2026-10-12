import type { IncomingMessage } from "node:http";
import { fetchIntradayCrossing } from "../src/yahoo.js";
import { formatTrendPrice } from "../src/format.js";
import { postToSlack } from "../src/slack.js";
import { TREND_SYMBOLS, type TrendSymbol } from "../src/trend-symbols.js";

interface CronRequest extends IncomingMessage {
  query?: Record<string, string | string[]>;
}

interface CronResponse {
  status(code: number): CronResponse;
  json(body: unknown): void;
}

// 전일 종가 대비 이 기준선(±%)을 "새로 넘을 때"만 알린다 — 높은 기준선일수록 추가 알림
const LEVELS = (process.env.INTRADAY_ALERT_LEVELS ?? "5,7,10,15,20")
  .split(",")
  .map((v) => Number(v.trim()))
  .filter((v) => Number.isFinite(v) && v > 0);
// 외부 크론 호출 간격(분)보다 약간 넓게 — 호출이 조금 늦어도 놓치지 않기 위함
const WINDOW_MIN = Number(process.env.INTRADAY_WINDOW_MIN ?? 17);

const WATCH_SYMBOLS: TrendSymbol[] = TREND_SYMBOLS.filter((s) => s.group !== "us_index");

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 외부 스케줄러(크롤러 PC 작업 스케줄러·cron-job.org 등)가 15분마다 호출하는 급변동 체크.
 * 1분봉으로 "방금 기준선을 넘었는지"를 판단하므로 상태 저장 없이도 같은 급변동이
 * 호출마다 반복 알림되지 않는다(이미 오래 전에 넘은 종목은 조용히 넘어감).
 * ?dry=1 이면 Slack에 보내지 않고 결과만 반환.
 */
export default async function handler(req: CronRequest, res: CronResponse) {
  const secret = process.env.INTRADAY_CRON_SECRET;
  const cronSecret = process.env.CRON_SECRET;
  const authed =
    (secret && first(req.query?.key) === secret) ||
    (cronSecret && req.headers.authorization === `Bearer ${cronSecret}`);
  if (!authed) return res.status(401).json({ error: "unauthorized" });
  const dry = first(req.query?.dry) === "1";

  const results = await Promise.all(
    WATCH_SYMBOLS.map(async (item) => ({
      item,
      r: await fetchIntradayCrossing(item.symbol, LEVELS, WINDOW_MIN),
    }))
  );

  const lines: string[] = [];
  for (const { item, r } of results) {
    if (!r || r.level == null) continue;
    const icon = r.changePct >= 0 ? "🟢" : "🔴";
    const sign = r.changePct > 0 ? "+" : "";
    const dir = r.changePct >= 0 ? "상승" : "하락";
    const age = Math.max(1, Math.round(r.ageMin ?? 0));
    lines.push(
      `${icon} *${item.label}* ${formatTrendPrice(r.price, item.symbol)} (전일비 ${sign}${r.changePct.toFixed(1)}%) — ${r.level}% ${dir} 돌파, ${age}분 전`
    );
  }

  if (lines.length > 0 && !dry) {
    await postToSlack(["🚨 *급변동 알림*", "", ...lines].join("\n"), {
      username: "stock-alert-bot",
      icon_emoji: ":rotating_light:",
    });
  }

  return res.status(200).json({
    alerted: lines.length,
    dry,
    lines,
    checked: results.map(({ item, r }) => ({
      symbol: item.symbol,
      changePct: r ? Number(r.changePct.toFixed(2)) : null,
      level: r?.level ?? null,
    })),
  });
}
