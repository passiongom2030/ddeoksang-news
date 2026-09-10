import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { fetchLivePrice } from "./yahoo.js";
import { formatTrendPrice } from "./format.js";
import { postToSlack } from "./slack.js";
import { TREND_SYMBOLS, type TrendSymbol } from "./trend-symbols.js";

/**
 * 장중 급변동(전일 종가 대비 ±THRESHOLD_PCT 이상) 감지 시 즉시 Slack 알림.
 * daily-alert.ts(장마감 후 1회 요약)와 달리 시장 시간 중 주기적으로 실행되며,
 * 같은 날 이미 알림 보낸 종목은 재알림하지 않는다 (data/intraday-alerted.json).
 *
 * 국내지수(us_index 그룹)는 개인 워치리스트가 아니라서 감시 대상에서 제외.
 */

const THRESHOLD_PCT = Number(process.env.INTRADAY_ALERT_THRESHOLD_PCT ?? 5);

const WATCH_SYMBOLS: TrendSymbol[] = TREND_SYMBOLS.filter(
  (s) => s.group !== "us_index"
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_PATH = path.join(__dirname, "..", "data", "intraday-alerted.json");

interface AlertState {
  date: string; // YYYY-MM-DD (KST 기준) — 날짜가 바뀌면 초기화
  alerted: string[]; // 오늘 이미 알림 보낸 심볼
}

function todayKst(): string {
  // UTC+9 오프셋만 더해 날짜만 뽑는다 (DST 없는 KST라 안전)
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function loadState(): Promise<AlertState> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as AlertState;
    if (parsed.date === todayKst()) return parsed;
  } catch {
    // 파일 없음/파싱 실패 — 새로 시작
  }
  return { date: todayKst(), alerted: [] };
}

async function saveState(state: AlertState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf-8");
}

function formatAlertLine(item: TrendSymbol, price: number, changePct: number): string {
  const icon = changePct >= 0 ? "🟢" : "🔴";
  const sign = changePct > 0 ? "+" : "";
  const priceLabel = formatTrendPrice(price, item.symbol);
  return `${icon} *${item.label}* ${priceLabel} (${sign}${changePct.toFixed(1)}%)`;
}

async function main(): Promise<void> {
  const state = await loadState();
  const alertedToday = new Set(state.alerted);
  const newAlerts: string[] = [];

  for (const item of WATCH_SYMBOLS) {
    if (alertedToday.has(item.symbol)) continue;

    const live = await fetchLivePrice(item.symbol);
    if (!live || live.changePct == null) continue;

    if (Math.abs(live.changePct) >= THRESHOLD_PCT) {
      newAlerts.push(formatAlertLine(item, live.price, live.changePct));
      alertedToday.add(item.symbol);
    }
  }

  if (newAlerts.length === 0) {
    console.log("급변동 없음 — 알림 스킵");
    return;
  }

  const message = [
    `🚨 *급변동 알림* (전일 종가 대비 ±${THRESHOLD_PCT}% 이상)`,
    "",
    ...newAlerts,
  ].join("\n");

  await postToSlack(message, { username: "stock-alert-bot", icon_emoji: ":rotating_light:" });
  console.log(`✅ 급변동 알림 게시 완료 (${newAlerts.length}건)`);

  await saveState({ date: todayKst(), alerted: [...alertedToday] });
}

main().catch((err) => {
  console.error("급변동 알림 실패:", err);
  process.exit(1);
});
