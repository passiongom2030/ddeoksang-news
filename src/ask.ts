import axios from "axios";
import { TREND_SYMBOLS, type TrendSymbol } from "./trend-symbols.js";
import { WATCHLIST } from "./watchlist.js";
import { fetchQuote } from "./yahoo.js";
import { formatTrendPrice } from "./format.js";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

function norm(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

/**
 * 질문 문장에서 워치리스트 종목을 찾는다 (LLM 없이 키워드 매칭 — 고정된 6종목이라 이걸로 충분).
 * watchlist.ts의 별칭 목록("하이닉스" 등 줄임말 포함)까지 함께 매칭한다.
 * 아무것도 안 걸리면 전체 워치리스트를 대상으로 한다.
 */
export function matchSymbolsInQuestion(question: string): TrendSymbol[] {
  const text = norm(question);

  const aliasHitLabels = new Set(
    WATCHLIST.filter(
      (w) =>
        w.names.some((n) => text.includes(norm(n))) || w.codes.some((c) => text.includes(norm(c)))
    ).map((w) => w.label)
  );

  const hits = TREND_SYMBOLS.filter(
    (s) => aliasHitLabels.has(s.label) || text.includes(norm(s.label)) || text.includes(norm(s.symbol))
  );
  if (hits.length > 0) return hits;
  return TREND_SYMBOLS;
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

function buildDataSummary(symbols: TrendSymbol[], quotes: Awaited<ReturnType<typeof fetchQuote>>[]): string {
  return quotes
    .map((q, i) => {
      const label = symbols[i]!.label;
      if (!q.ok) return `${label}: 조회 실패`;
      const price = formatTrendPrice(q.price, q.symbol);
      const sign = q.changePct >= 0 ? "+" : "";
      const volume = q.volume != null ? q.volume.toLocaleString("en-US") : "-";
      return `${label}: 현재가 ${price}, 등락률 ${sign}${q.changePct.toFixed(1)}%, 거래량 ${volume}`;
    })
    .join("\n");
}

/**
 * 자유 질문에 대해 워치리스트 실시간 데이터를 바탕으로 답변한다.
 * 매수/매도 판단은 절대 하지 않는다 — 데이터 설명·비교까지만 (ai-investor-coach와 역할 분리).
 */
export async function askAboutStocks(question: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const symbols = matchSymbolsInQuestion(question);
  const quotes = await Promise.all(symbols.map((s) => fetchQuote(s)));
  const dataSummary = buildDataSummary(symbols, quotes);

  const prompt = `사용자 질문: "${question}"

아래는 관련 종목의 실시간 데이터입니다:
${dataSummary}

위 데이터를 바탕으로 질문에 답변하세요.

규칙 (반드시 지킬 것):
- 데이터를 설명하거나 종목 간 비교만 할 것.
- 매수/매도 판단, 투자 의견, "사세요/파세요/좋아 보입니다" 같은 표현은 절대 하지 말 것.
- 판단이 필요한 질문이면 "그건 데이터로 답할 수 있는 범위가 아니에요"라고 답할 것.
- 2~3문장, 한국어, Slack 메시지에 어울리는 간결한 톤.`;

  const res = await callGemini(key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 512, temperature: 0.2 },
  });

  const text: string | undefined = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text?.trim() ?? "답변을 생성하지 못했습니다.";
}
