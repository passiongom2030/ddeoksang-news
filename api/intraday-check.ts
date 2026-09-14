import type { IncomingMessage } from "node:http";
import { fetchLivePrice } from "../src/yahoo.js";
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

const THRESHOLD_PCT = Number(process.env.INTRADAY_ALERT_THRESHOLD_PCT ?? 5);

const WATCH_SYMBOLS: TrendSymbol[] = TREND_SYMBOLS.filter(
  (s) => s.group !== "us_index"
);

function formatAlertLine(item: TrendSymbol, price: number, changePct: number): string {
  const icon = changePct >= 0 ? "🟢" : "🔴";
  const sign = changePct > 0 ? "+" : "";
  const priceLabel = formatTrendPrice(price, item.symbol);
  return `${icon} *${item.label}* ${priceLabel} (${sign}${changePct.toFixed(1)}%)`;
}

/**
 * 외부 크론 핑 서비스(cron-job.org 등)가 호출하는 급변동 체크 엔드포인트.
 * GitHub Actions의 schedule 트리거가 몇 시간씩 지연되는 문제를 우회하려고
 * intraday-alert.ts와 같은 로직을 Vercel 서버리스로 옮긴 버전.
 *
 * 상태 저장(당일 중복 알림 방지) 없이 매 호출마다 현재 상태만 판단 — 대신 외부
 * 크론의 호출 간격(예: 15~30분) 자체가 자연스러운 알림 빈도 제한 역할을 한다.
 * 즉, 급변동이 지속되는 동안은 호출될 때마다 반복 알림이 갈 수 있음(의도된 단순화).
 */
export default async function handler(req: CronRequest, res: CronResponse) {
  const secret = process.env.INTRADAY_CRON_SECRET;
  const provided = req.query?.key;
  const providedKey = Array.isArray(provided) ? provided[0] : provided;

  if (!secret || providedKey !== secret) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const alerts: string[] = [];
  const checked: Array<{ symbol: string; changePct: number | null }> = [];

  for (const item of WATCH_SYMBOLS) {
    const live = await fetchLivePrice(item.symbol);
    checked.push({ symbol: item.symbol, changePct: live?.changePct ?? null });
    if (!live || live.changePct == null) continue;

    if (Math.abs(live.changePct) >= THRESHOLD_PCT) {
      alerts.push(formatAlertLine(item, live.price, live.changePct));
    }
  }

  if (alerts.length > 0) {
    const message = [
      `🚨 *급변동 알림* (전일 종가 대비 ±${THRESHOLD_PCT}% 이상)`,
      "",
      ...alerts,
    ].join("\n");
    await postToSlack(message, { username: "stock-alert-bot", icon_emoji: ":rotating_light:" });
  }

  return res.status(200).json({ alerted: alerts.length, checked });
}
