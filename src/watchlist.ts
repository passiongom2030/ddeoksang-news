import type { NewsArticle } from "./collector.js";
import type { Analysis } from "./analyzer.js";

// 관심종목 (Obsidian 워치리스트를 레포에 반영 — Actions는 vault를 못 읽으므로 여기서 관리)
interface WatchItem {
  label: string; // 표시명
  names: string[]; // 본문/제목 매칭용 별칭
  codes: string[]; // related.symbol 매칭용 (티커·종목코드)
}

export const WATCHLIST: WatchItem[] = [
  { label: "삼성전자", names: ["삼성전자", "Samsung Electronics"], codes: ["005930"] },
  { label: "삼성전기", names: ["삼성전기"], codes: ["009150"] },
  { label: "SK하이닉스", names: ["SK하이닉스", "하이닉스", "Hynix", "SK Hynix"], codes: ["000660"] },
  { label: "엔비디아", names: ["엔비디아", "Nvidia", "NVIDIA"], codes: ["NVDA"] },
  { label: "마이크론", names: ["마이크론", "Micron"], codes: ["MU"] },
  { label: "비트코인", names: ["비트코인", "Bitcoin"], codes: ["BTC", "BTCUSDT"] },
];

function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/**
 * 뉴스+분석이 관심종목과 관련되면 매칭된 라벨 목록을 반환한다.
 * 우선 related 티커(코드)로 매칭, 없으면 제목/요약 텍스트에서 종목명 검색.
 */
export function matchWatchlist(article: NewsArticle, analysis: Analysis): string[] {
  const relatedSyms = new Set(analysis.related.map((r) => norm(r.symbol)));
  const text = `${analysis.headline_ko} ${article.title} ${analysis.summary}`;

  const hits: string[] = [];
  for (const item of WATCHLIST) {
    const byCode = item.codes.some((c) => relatedSyms.has(norm(c)));
    const byRelatedName =
      relatedSyms.has(norm(item.label)) || item.names.some((n) => relatedSyms.has(norm(n)));
    const byName = item.names.some((n) => text.includes(n));
    if (byCode || byRelatedName || byName) hits.push(item.label);
  }
  return hits;
}
