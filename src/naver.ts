import axios from "axios";

const NAVER_HEADERS = { Referer: "https://m.stock.naver.com/", "User-Agent": "Mozilla/5.0" };

export interface NaverSearchResult {
  code: string;
  name: string;
  market: string; // 코스피/코스닥 등
}

export interface NaverTrendDay {
  bizdate: string; // YYYYMMDD
  closePrice: string;
  compareToPreviousClosePrice: string;
  foreignerPureBuyQuant: string;
  organPureBuyQuant: string;
  individualPureBuyQuant: string;
  accumulatedTradingVolume: string;
}

export interface NaverQuote {
  name: string;
  code: string;
  price: string;
  changeAmount: string;
  per: string;
  pbr: string;
  marketCap: string;
  high52: string;
  low52: string;
  foreignerHoldRatio: string;
  /** 네이버 integration API가 제공하는 최근 5거래일 (그 이상은 무료 API로 미제공) */
  recentTrend: NaverTrendDay[];
}

/** 종목명/코드로 국내 상장 종목을 검색한다 (워치리스트 제한 없이 임의 종목 조회용). */
export async function searchKoreanStock(query: string): Promise<NaverSearchResult | null> {
  try {
    const { data } = await axios.get(
      "https://m.stock.naver.com/front-api/search/autoComplete",
      { headers: NAVER_HEADERS, params: { query, target: "stock" }, timeout: 8000 }
    );
    const items = data?.result?.items ?? [];
    const first = items.find((it: any) => it.category === "stock") ?? items[0];
    if (!first?.code || !first?.name) return null;
    return { code: first.code, name: first.name, market: first.typeName ?? "KRX" };
  } catch (err) {
    console.warn("네이버 종목 검색 실패:", query, (err as Error).message);
    return null;
  }
}

/** 종목코드로 현재가·지표·최근 5거래일 외국인/기관/개인 매매 동향을 조회한다. */
export async function fetchNaverQuote(code: string): Promise<NaverQuote | null> {
  try {
    const { data } = await axios.get(
      `https://m.stock.naver.com/api/stock/${code}/integration`,
      { headers: NAVER_HEADERS, timeout: 8000 }
    );
    if (!data?.itemCode) return null;

    const info: Record<string, string> = {};
    for (const item of data.totalInfos ?? []) {
      if (item.code && item.value) info[item.code] = item.value;
    }

    const trend: NaverTrendDay[] = (data.dealTrendInfos ?? []).map((d: any) => ({
      bizdate: d.bizdate ?? "",
      closePrice: d.closePrice ?? "-",
      compareToPreviousClosePrice: d.compareToPreviousClosePrice ?? "-",
      foreignerPureBuyQuant: d.foreignerPureBuyQuant ?? "-",
      organPureBuyQuant: d.organPureBuyQuant ?? "-",
      individualPureBuyQuant: d.individualPureBuyQuant ?? "-",
      accumulatedTradingVolume: d.accumulatedTradingVolume ?? "-",
    }));

    const latest = trend[0];

    return {
      name: data.stockName ?? "",
      code: data.itemCode,
      price: latest?.closePrice ?? info.lastClosePrice ?? "-",
      changeAmount: latest?.compareToPreviousClosePrice ?? "-",
      per: info.per ?? "-",
      pbr: info.pbr ?? "-",
      marketCap: info.marketValue ?? "-",
      high52: info.highPriceOf52Weeks ?? "-",
      low52: info.lowPriceOf52Weeks ?? "-",
      foreignerHoldRatio: latest?.["foreignerHoldRatio" as keyof NaverTrendDay] ?? (data.dealTrendInfos?.[0]?.foreignerHoldRatio ?? "-"),
      recentTrend: trend,
    };
  } catch (err) {
    console.warn("네이버 시세 조회 실패:", code, (err as Error).message);
    return null;
  }
}

/** 사람이 읽기 좋은 텍스트로 요약 (Gemini 프롬프트용 데이터 블록). */
export function formatNaverQuoteForPrompt(q: NaverQuote): string {
  const trendLines = q.recentTrend
    .map((d) => {
      const date = d.bizdate.length === 8 ? `${d.bizdate.slice(4, 6)}/${d.bizdate.slice(6, 8)}` : d.bizdate;
      return `  ${date}: 종가 ${d.closePrice} (${d.compareToPreviousClosePrice}), 외국인 순매수 ${d.foreignerPureBuyQuant}주, 기관 순매수 ${d.organPureBuyQuant}주, 개인 순매수 ${d.individualPureBuyQuant}주, 거래량 ${d.accumulatedTradingVolume}`;
    })
    .join("\n");

  return `${q.name} (네이버 데이터): 현재가 ${q.price}원 (전일대비 ${q.changeAmount}), PER ${q.per}, PBR ${q.pbr}, 시가총액 ${q.marketCap}, 52주 최고/최저 ${q.high52}/${q.low52}
최근 거래일별 추이 (외국인 지분율 ${q.foreignerHoldRatio}):
${trendLines}`;
}
