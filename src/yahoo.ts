import axios from "axios";
import { TREND_SYMBOLS, type TrendSymbol } from "./trend-symbols.js";

export interface QuoteResult {
  symbol: string;
  label: string;
  group: TrendSymbol["group"];
  ok: true;
  price: number;
  /** 최근 5거래일 누적 변화율 (/동향·daily-alert 용도) — "오늘 등락률"이 아님 */
  changePct: number;
  /** 가장 최근 거래일 종가 대비 전 거래일 종가 변화율 (일봉 마지막 2개 기준) */
  dayChangePct: number | null;
  prevClose: number;
  volume: number | null;
}

export interface QuoteFailure {
  symbol: string;
  label: string;
  group: TrendSymbol["group"];
  ok: false;
  error: string;
}

export type QuoteRow = QuoteResult | QuoteFailure;

interface CacheEntry {
  row: QuoteRow;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

interface YahooChartResponse {
  chart?: {
    result?: Array<{
      timestamp?: number[];
      meta?: { regularMarketPrice?: number; previousClose?: number; chartPreviousClose?: number };
      indicators?: {
        quote?: Array<{ close?: Array<number | null>; volume?: Array<number | null> }>;
      };
    }>;
    error?: { code?: string; description?: string } | null;
  };
}

function firstLastValid(closes: Array<number | null | undefined>): {
  first: number;
  last: number;
} | null {
  const valid = closes.filter((c): c is number => typeof c === "number" && Number.isFinite(c));
  if (valid.length < 2) return null;
  return { first: valid[0]!, last: valid[valid.length - 1]! };
}

function lastValid(values: Array<number | null | undefined> = []): number | null {
  const valid = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  // 지수(^GSPC 등)는 거래량을 0으로 보고함 — 실제 무거래가 아니라 미제공이므로 null 처리
  const last = valid.length ? valid[valid.length - 1]! : null;
  return last === 0 ? null : last;
}

/**
 * 야후 chart API로 최근 5거래일 등락률을 구한다.
 * 심볼별 try-catch 격리 — 실패해도 다른 심볼에 영향 없음.
 */
export async function fetchQuote(item: TrendSymbol): Promise<QuoteRow> {
  const cached = cache.get(item.symbol);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.row;
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(item.symbol)}`;
    const { data } = await axios.get<YahooChartResponse>(url, {
      params: { range: "5d", interval: "1d" },
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      timeout: 8000,
    });

    const result = data.chart?.result?.[0];
    if (!result) {
      const desc = data.chart?.error?.description ?? "empty result";
      throw new Error(desc);
    }

    const closes = result.indicators?.quote?.[0]?.close ?? [];
    const pair = firstLastValid(closes);
    if (!pair) {
      throw new Error("insufficient close data");
    }

    const price =
      typeof result.meta?.regularMarketPrice === "number" &&
      Number.isFinite(result.meta.regularMarketPrice)
        ? result.meta.regularMarketPrice
        : pair.last;

    const changePct = ((pair.last - pair.first) / pair.first) * 100;
    const volume = lastValid(result.indicators?.quote?.[0]?.volume ?? []);

    const validCloses = closes.filter(
      (c): c is number => typeof c === "number" && Number.isFinite(c)
    );
    const dayChangePct =
      validCloses.length >= 2
        ? ((price - validCloses[validCloses.length - 2]!) / validCloses[validCloses.length - 2]!) * 100
        : null;

    const row: QuoteResult = {
      symbol: item.symbol,
      label: item.label,
      group: item.group,
      ok: true,
      price,
      changePct,
      dayChangePct,
      prevClose: pair.first,
      volume,
    };

    cache.set(item.symbol, { row, expiresAt: Date.now() + CACHE_TTL_MS });
    return row;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const row: QuoteFailure = {
      symbol: item.symbol,
      label: item.label,
      group: item.group,
      ok: false,
      error: message,
    };
    // 실패는 짧게만 캐시(연속 실패 폭주 방지, 재시도 여지 유지)
    cache.set(item.symbol, { row, expiresAt: Date.now() + 15_000 });
    return row;
  }
}

/** 워치리스트 심볼을 병렬 조회한다. */
export async function fetchAllQuotes(
  symbols: TrendSymbol[] = TREND_SYMBOLS
): Promise<QuoteRow[]> {
  return Promise.all(symbols.map((s) => fetchQuote(s)));
}

/** 테스트/디버그용 캐시 초기화 */
export function clearQuoteCache(): void {
  cache.clear();
}

export interface LivePrice {
  price: number;
  previousClose: number | null;
  changePct: number | null;
}

/**
 * 실시간에 가까운 현재가 + 전일 종가 대비 등락률을 가져온다.
 * fetchQuote()는 5일 range로 호출해서 previousClose가 응답에 아예 안 실려오는 문제가 있어
 * (5일 전 종가인 chartPreviousClose로 잘못 계산되는 버그 발생) — 1일 range로 별도 호출한다.
 */
export async function fetchLivePrice(symbol: string): Promise<LivePrice | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const { data } = await axios.get<YahooChartResponse>(url, {
      params: { range: "1d", interval: "1m" },
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      timeout: 8000,
    });

    const meta = data.chart?.result?.[0]?.meta;
    if (!meta || typeof meta.regularMarketPrice !== "number") return null;

    const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
    const changePct =
      previousClose && previousClose > 0
        ? ((meta.regularMarketPrice - previousClose) / previousClose) * 100
        : null;

    return { price: meta.regularMarketPrice, previousClose, changePct };
  } catch (err) {
    console.warn("Yahoo 실시간 가격 조회 실패:", symbol, (err as Error).message);
    return null;
  }
}

export interface IntradayCrossing {
  price: number;
  /** 전일 종가 대비 현재 등락률 */
  changePct: number;
  /** 최근 windowMin분 안에 새로 넘은 가장 높은 기준선(절댓값 %) — 없으면 null */
  level: number | null;
  /** 해당 기준선을 넘은 지 몇 분 됐는지 */
  ageMin: number | null;
}

/**
 * 1분봉으로 "방금 기준선(±level%)을 새로 넘었는지" 판단한다.
 * 상태 저장 없이 중복 알림을 피하려는 목적 — 이미 오래 전에 넘은 상태는 level=null.
 * 마지막 봉이 staleMin분보다 오래됐으면(장 마감 중) level=null.
 */
export async function fetchIntradayCrossing(
  symbol: string,
  levels: number[],
  windowMin: number,
  staleMin = 30
): Promise<IntradayCrossing | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`;
    const { data } = await axios.get<YahooChartResponse>(url, {
      params: { range: "1d", interval: "1m" },
      headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
      timeout: 8000,
    });

    const result = data.chart?.result?.[0];
    const meta = result?.meta;
    const ts = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];
    const prev = meta?.previousClose ?? meta?.chartPreviousClose;
    if (!result || !prev || prev <= 0) return null;

    const pts: Array<{ t: number; pct: number; c: number }> = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        pts.push({ t: ts[i]!, pct: ((c - prev) / prev) * 100, c });
      }
    }
    if (pts.length === 0) return null;

    const last = pts[pts.length - 1]!;
    const nowSec = Date.now() / 1000;
    const base: IntradayCrossing = { price: last.c, changePct: last.pct, level: null, ageMin: null };
    if (nowSec - last.t > staleMin * 60) return base;

    for (const level of [...levels].sort((a, b) => b - a)) {
      if (Math.abs(last.pct) < level) continue;
      const sign = Math.sign(last.pct);
      // 가장 최근에 이 기준선 안쪽(또는 반대 부호)이었던 봉 다음 봉이 "넘은 시각"
      let crossT = pts[0]!.t;
      for (let i = pts.length - 1; i >= 0; i--) {
        const p = pts[i]!;
        if (Math.abs(p.pct) < level || Math.sign(p.pct) !== sign) {
          crossT = pts[i + 1]?.t ?? last.t;
          break;
        }
      }
      const ageMin = (nowSec - crossT) / 60;
      if (ageMin <= windowMin) return { ...base, level, ageMin: Math.max(0, ageMin) };
    }
    return base;
  } catch (err) {
    console.warn("Yahoo 1분봉 조회 실패:", symbol, (err as Error).message);
    return null;
  }
}
