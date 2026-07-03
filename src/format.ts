import type { NewsArticle } from "./collector.js";
import type { Analysis } from "./analyzer.js";

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
      return "bullish 📈";
    case "bearish":
      return "bearish 📉";
    default:
      return "neutral";
  }
}

/**
 * 뉴스 1건 = 메시지 1개 (레퍼런스 스타일).
 * 분석 실패 시(analysis=null) 헤드라인+출처만 폴백 게시.
 */
export function formatAnalyzedItem(a: NewsArticle, analysis: Analysis | null): string {
  const sourceLink = a.url ? `<${a.url}|${a.source}>` : a.source;

  if (!analysis) {
    return [`📰 *${esc(a.title)}*`, `• sources: ${sourceLink}`].join("\n");
  }

  // 한국어 제목 우선 (영어 기사도 한글화), 없으면 원제목
  const title = esc(analysis.headline_ko || a.title);
  const lines: string[] = [`${importanceIcon(analysis.importance)} *${title}*`];
  if (analysis.summary) lines.push(analysis.summary);
  lines.push("");
  lines.push(
    `• importance: ${analysis.importance} / sentiment: ${sentimentLabel(analysis.sentiment)} / category: ${analysis.category}`
  );
  if (analysis.related.length) {
    const rel = analysis.related
      .map((r) => `${esc(r.symbol)} ${r.market} ${Math.round(r.confidence)}`)
      .join(", ");
    lines.push(`• related: ${rel}`);
  }
  if (analysis.tags.length) {
    lines.push(`• tags: ${analysis.tags.map(esc).join(", ")}`);
  }
  lines.push(`• sources: ${sourceLink}`);

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
