/** /동향 조회 대상 — 심볼은 야후 파이낸스 chart API 기준 */

export type TrendGroup = "us_index" | "kr_watch" | "us_watch" | "crypto" | "portfolio";

export interface TrendSymbol {
  symbol: string;
  label: string;
  group: TrendGroup;
}

export const TREND_GROUP_LABELS: Record<TrendGroup, string> = {
  us_index: "미국 지수",
  kr_watch: "국내 워치리스트",
  us_watch: "미국 워치리스트",
  crypto: "암호화폐",
  portfolio: "포트폴리오 보유종목",
};

/** 그룹 표시 순서 */
export const TREND_GROUP_ORDER: TrendGroup[] = [
  "us_index",
  "kr_watch",
  "us_watch",
  "crypto",
  "portfolio",
];

/**
 * 1차 MVP 고정 세트. 나중에 여기만 추가하면 확장됨.
 */
export const TREND_SYMBOLS: TrendSymbol[] = [
  // 미국 지수
  { symbol: "^GSPC", label: "S&P500", group: "us_index" },
  { symbol: "^IXIC", label: "나스닥종합", group: "us_index" },
  { symbol: "^SOX", label: "필라델피아반도체", group: "us_index" },
  // 국내 워치리스트
  { symbol: "005930.KS", label: "삼성전자", group: "kr_watch" },
  { symbol: "000660.KS", label: "SK하이닉스", group: "kr_watch" },
  { symbol: "009150.KS", label: "삼성전기", group: "kr_watch" },
  // 미국 워치리스트
  { symbol: "NVDA", label: "엔비디아", group: "us_watch" },
  { symbol: "MU", label: "마이크론", group: "us_watch" },
  // 선택
  { symbol: "BTC-USD", label: "비트코인", group: "crypto" },
  // 포트폴리오 주요 보유종목 (2026-08-31 자산관리 스냅샷 기준, 평가금액 500만원 이상만) — 2026-09-10 추가
  { symbol: "005380.KS", label: "현대차", group: "portfolio" },
  { symbol: "042700.KS", label: "한미반도체", group: "portfolio" },
  { symbol: "0193T0.KS", label: "KODEX SK하이닉스단일종목레버리지", group: "portfolio" },
  { symbol: "411060.KS", label: "ACE KRX금현물", group: "portfolio" },
  { symbol: "379810.KS", label: "KODEX 미국나스닥100", group: "portfolio" },
  { symbol: "133690.KS", label: "TIGER 미국나스닥100", group: "portfolio" },
  { symbol: "360750.KS", label: "TIGER 미국S&P500", group: "portfolio" },
  { symbol: "GOOGL", label: "알파벳 Class A", group: "portfolio" },
  { symbol: "AMZN", label: "아마존닷컴", group: "portfolio" },
  { symbol: "QQQ", label: "INVESCO QQQ TRUST", group: "portfolio" },
  { symbol: "NVDL", label: "NVDL", group: "portfolio" },
  { symbol: "SOXL", label: "Direxion Daily Semiconductor Bull 3X", group: "portfolio" },
];
