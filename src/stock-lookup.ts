import axios from "axios";
import { TREND_SYMBOLS, type TrendSymbol } from "./trend-symbols.js";
import { WATCHLIST } from "./watchlist.js";
import { fetchQuote } from "./yahoo.js";
import { formatTrendPrice } from "./format.js";
import { searchKoreanStock, fetchNaverQuote, formatNaverQuoteForPrompt } from "./naver.js";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

async function callGemini(key: string, body: unknown, maxRetries = 1): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post(url, body, {
        params: { key },
        headers: { "Content-Type": "application/json" },
        timeout: 15000,
      });
    } catch (err) {
      lastErr = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const retryable = status === 503 || status === 429 || status === 500;
      if (!retryable || attempt === maxRetries) throw err;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastErr;
}

const TICKER_SCHEMA = {
  type: "OBJECT",
  properties: {
    tickers: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "질문/대화에서 언급된 주식·코인 종목명 (사람이 부르는 이름 그대로, 예: 삼성전자, 엔비디아, 비트코인). 특정 종목 언급 없으면 빈 배열.",
    },
  },
  required: ["tickers"],
};

/** 자유 텍스트에서 언급된 종목명을 LLM으로 추출한다 (워치리스트 제한 없음). */
export async function extractStockNames(text: string): Promise<string[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const res = await callGemini(key, {
    contents: [{ parts: [{ text: `다음 텍스트에서 언급된 주식/코인 종목명을 추출하세요:\n\n${text}` }] }],
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: TICKER_SCHEMA,
    },
  });

  const jsonText: string | undefined = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!jsonText) return [];
  try {
    const parsed = JSON.parse(jsonText) as { tickers?: string[] };
    return Array.isArray(parsed.tickers) ? parsed.tickers : [];
  } catch {
    return [];
  }
}

function findWatchlistSymbol(name: string): TrendSymbol | null {
  const key = norm(name);
  const aliasHit = WATCHLIST.find(
    (w) => w.names.some((n) => norm(n) === key) || w.codes.some((c) => norm(c) === key)
  );
  const label = aliasHit?.label;
  return TREND_SYMBOLS.find((s) => (label && s.label === label) || norm(s.label) === key || norm(s.symbol) === key) ?? null;
}

/**
 * 이름 목록을 실제 조회 가능한 데이터 블록으로 변환한다.
 * - 워치리스트에 있는 종목: 기존 그룹(국내=네이버, 해외/코인=Yahoo)으로 조회
 * - 워치리스트에 없는 종목: 네이버 검색으로 임의 국내 종목까지 조회 (해외 임의 종목은 미지원)
 */
async function buildDataBlockFor(name: string): Promise<string> {
  const known = findWatchlistSymbol(name);
  if (known) {
    if (known.group === "kr_watch") {
      const code = known.symbol.replace(/\.(KS|KQ)$/, "");
      const q = await fetchNaverQuote(code);
      return q ? formatNaverQuoteForPrompt(q) : `${known.label}: 조회 실패`;
    }
    const q = await fetchQuote(known);
    if (!q.ok) return `${known.label}: 조회 실패`;
    const price = formatTrendPrice(q.price, q.symbol);
    const sign = q.changePct >= 0 ? "+" : "";
    const volume = q.volume != null ? q.volume.toLocaleString("en-US") : "-";
    return `${known.label}: 현재가 ${price}, 등락률 ${sign}${q.changePct.toFixed(1)}%, 거래량 ${volume}`;
  }

  // 워치리스트 밖 — 네이버 검색으로 국내 종목 임의 조회 시도
  const found = await searchKoreanStock(name);
  if (!found) return `"${name}": 종목을 찾지 못했습니다 (국내 상장 종목만 임의 검색 지원).`;
  const q = await fetchNaverQuote(found.code);
  return q ? formatNaverQuoteForPrompt(q) : `${found.name}: 조회 실패`;
}

/**
 * 질문/대화 텍스트를 받아 관련 종목 데이터 블록 전체를 만든다.
 * 특정 종목이 감지되지 않으면 워치리스트 전체를 대상으로 한다.
 */
export async function buildStockDataSummary(text: string): Promise<string> {
  const names = await extractStockNames(text);

  if (names.length === 0) {
    const blocks = await Promise.all(
      TREND_SYMBOLS.map(async (s) => {
        if (s.group === "kr_watch") {
          const code = s.symbol.replace(/\.(KS|KQ)$/, "");
          const q = await fetchNaverQuote(code);
          return q ? formatNaverQuoteForPrompt(q) : `${s.label}: 조회 실패`;
        }
        const q = await fetchQuote(s);
        if (!q.ok) return `${s.label}: 조회 실패`;
        const price = formatTrendPrice(q.price, q.symbol);
        const sign = q.changePct >= 0 ? "+" : "";
        const volume = q.volume != null ? q.volume.toLocaleString("en-US") : "-";
        return `${s.label}: 현재가 ${price}, 등락률 ${sign}${q.changePct.toFixed(1)}%, 거래량 ${volume}`;
      })
    );
    return blocks.join("\n\n");
  }

  const blocks = await Promise.all(names.map((n) => buildDataBlockFor(n)));
  return blocks.join("\n\n");
}
