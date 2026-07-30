/** /동향 조회 대상 — 심볼은 야후 파이낸스 chart API 기준 */

export type TrendGroup = "us_index" | "kr_watch" | "us_watch" | "crypto";

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
};

/** 그룹 표시 순서 */
export const TREND_GROUP_ORDER: TrendGroup[] = [
  "us_index",
  "kr_watch",
  "us_watch",
  "crypto",
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
];
