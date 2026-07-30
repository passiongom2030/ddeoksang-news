import type { NewsArticle } from "./collector.js";
import type { Analysis } from "./analyzer.js";
import { matchWatchlist } from "./watchlist.js";
import {
  TREND_GROUP_LABELS,
  TREND_GROUP_ORDER,
  type TrendGroup,
} from "./trend-symbols.js";
import type { QuoteRow } from "./yahoo.js";

// Slack mrkdwn 이스케이프
function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function importanceIcon(importance: Analysis["importance"]): string {
  switch (importance) {
    case "HIGH":
      return "🚨";
    case "LOW":
      return "📄";
    default:
      return "📊";
  }
}

function sentimentLabel(sentiment: Analysis["sentiment"]): string {
  switch (sentiment) {
    case "bullish":
      return "📈 강세(Bullish)";
    case "bearish":
      return "📉 약세(Bearish)";
    default:
      return "➖ 중립(Neutral)";
  }
}

function categoryLabel(category: Analysis["category"], region: NewsArticle["region"]): string {
  switch (category) {
    case "stock":
      return region === "global" ? "해외주식(Stock)" : "국내주식(Stock)";
    case "crypto":
      return "코인(Crypto)";
    case "macro":
      return "매크로(Macro)";
    case "fx":
      return "환율(FX)";
    case "commodity":
      return "원자재(Commodity)";
  }
}

/**
 * 뉴스 1건 = 메시지 1개 (레퍼런스 스타일).
 * 분석 실패 시(analysis=null) 헤드라인+출처만 폴백 게시.
 */
export function formatAnalyzedItem(a: NewsArticle, analysis: Analysis | null): string {
  const sourceLink = a.url ? `<${a.url}|${a.source}>` : a.source;

  if (!analysis) {
    return [`📰 *${esc(a.title)}*`, "", `• 출처   ${sourceLink}`].join("\n");
  }

  const title = esc(analysis.headline_ko || a.title);
  const watched = matchWatchlist(a, analysis);
  const star = watched.length ? "⭐ " : "";

  const lines: string[] = [`${star}${importanceIcon(analysis.importance)} *${title}*`];
  if (analysis.summary) lines.push(analysis.summary);
  lines.push("");
  lines.push(`• 판단   ${sentimentLabel(analysis.sentiment)}`);

  const related = analysis.related
    .filter((r) => r.confidence >= 60)
    .map((r) => esc(r.symbol));
  if (related.length) {
    lines.push(`• 관련   ${related.join(" · ")}`);
  }

  const classification = [categoryLabel(analysis.category, a.region), ...analysis.tags.map(esc)].join(" · ");
  lines.push(`• 분류   ${classification}`);
  lines.push(`• 출처   ${sourceLink}`);

  return lines.join("\n");
}

// ---- 레거시 묶음형 (폴백/옵션) ----

function nowLabel(): string {
  return new Date().toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatNewsMessage(articles: NewsArticle[]): string {
  const parts: string[] = [`📈 *최신 뉴스* | ${nowLabel()}`, ""];
  for (const a of articles) {
    const text = a.url ? `<${a.url}|${esc(a.title)}>` : esc(a.title);
    parts.push(`• ${text}  _${a.source}_`);
  }
  return parts.join("\n");
}

// ---- /동향 주가 동향 ----

function trendDateLabel(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

/** 심볼 성격에 맞춰 현재가 표시 (국내=정수, 그 외=소수 2자리) */
export function formatTrendPrice(price: number, symbol: string): string {
  if (symbol.endsWith(".KS") || symbol.endsWith(".KQ")) {
    return Math.round(price).toLocaleString("en-US");
  }
  if (symbol === "BTC-USD" || symbol.startsWith("BTC")) {
    return Math.round(price).toLocaleString("en-US");
  }
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChangePct(changePct: number): string {
  const sign = changePct > 0 ? "+" : "";
  return `${sign}${changePct.toFixed(1)}%`;
}

function formatVolume(volume: number | null | undefined): string {
  if (volume == null) return "-";
  return volume.toLocaleString("en-US");
}

function formatQuoteLine(row: QuoteRow): string {
  if (!row.ok) {
    return `— ${esc(row.label)} 조회 실패`;
  }
  const icon = row.changePct >= 0 ? "🟢" : "🔴";
  const price = formatTrendPrice(row.price, row.symbol);
  return `${icon} ${esc(row.label)} ${price} (${formatChangePct(row.changePct)}) · 거래량 ${formatVolume(row.volume)}`;
}

/**
 * 최근 일주일(5거래일) 글로벌 주가 동향 리치 메시지.
 */
export function formatTrendMessage(
  rows: QuoteRow[],
  title = "📊 *최근 일주일 글로벌 주가 동향*"
): string {
  const byGroup = new Map<TrendGroup, QuoteRow[]>();
  for (const row of rows) {
    const list = byGroup.get(row.group) ?? [];
    list.push(row);
    byGroup.set(row.group, list);
  }

  const parts: string[] = [`${title} | ${trendDateLabel()}`];

  for (const group of TREND_GROUP_ORDER) {
    const list = byGroup.get(group);
    if (!list?.length) continue;
    parts.push("");
    parts.push(`〈${TREND_GROUP_LABELS[group]}〉`);
    for (const row of list) {
      parts.push(formatQuoteLine(row));
    }
  }

  return parts.join("\n");
}
