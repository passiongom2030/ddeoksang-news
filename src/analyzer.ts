import axios from "axios";
import type { NewsArticle } from "./collector.js";

export interface RelatedTicker {
  symbol: string;
  market: "STOCK" | "ETF" | "CRYPTO" | "INDEX";
  confidence: number; // 0-100
}

export interface Analysis {
  summary: string;
  importance: "HIGH" | "NORMAL" | "LOW";
  sentiment: "bullish" | "neutral" | "bearish";
  category: "stock" | "crypto" | "macro" | "fx" | "commodity";
  related: RelatedTicker[];
  tags: string[];
}

const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash-lite";

// Gemini 구조화 출력 스키마 (OpenAPI 서브셋 — 타입 대문자)
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    summary: { type: "STRING", description: "핵심을 한국어 2줄 이내로 요약. 영어 기사는 번역." },
    importance: { type: "STRING", enum: ["HIGH", "NORMAL", "LOW"] },
    sentiment: { type: "STRING", enum: ["bullish", "neutral", "bearish"] },
    category: { type: "STRING", enum: ["stock", "crypto", "macro", "fx", "commodity"] },
    related: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          symbol: { type: "STRING" },
          market: { type: "STRING", enum: ["STOCK", "ETF", "CRYPTO", "INDEX"] },
          confidence: { type: "INTEGER", description: "관련도 0~100 정수 (90=매우 관련, 50=보통)" },
        },
        required: ["symbol", "market", "confidence"],
      },
    },
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["summary", "importance", "sentiment", "category", "related", "tags"],
  propertyOrdering: ["summary", "importance", "sentiment", "category", "related", "tags"],
};

function buildPrompt(article: NewsArticle): string {
  return `아래 주식/금융 뉴스를 투자자 관점에서 구조화 분석하세요.

제목: ${article.title}
출처: ${article.source} (${article.lang === "en" ? "영어" : "한국어"})
내용: ${article.description || "(요약 없음 — 제목 기반으로 판단)"}

규칙:
- summary는 반드시 한국어. 영어 기사는 번역해서 요약.
- importance: 지수/대형주/정책 등 시장 파급력이 크면 HIGH.
- related: 명확히 관련된 종목/지수만. 애매하면 빈 배열. confidence는 반드시 0~100 정수(관련도가 높을수록 큰 값, 예: 90).
- tags: 짧은 한국어 키워드 2-4개 (예: 반도체, 실적, 금리).
- 특정 종목 매수/매도를 권유하지 말 것.`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 503(과부하)/429(레이트리밋) 등 일시 오류는 백오프 후 재시도
async function callGemini(key: string, body: unknown, maxRetries = 2): Promise<any> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await axios.post(url, body, {
        params: { key },
        headers: { "Content-Type": "application/json" },
        timeout: 20000,
      });
    } catch (err) {
      lastErr = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const retryable = status === 503 || status === 429 || status === 500;
      if (!retryable || attempt === maxRetries) throw err;
      // 429는 분당 한도라 길게(15s, 30s), 503/500은 짧게(1.5s, 3s)
      const base = status === 429 ? 15000 : 1500;
      const wait = base * (attempt + 1);
      console.log(`   ↻ Gemini ${status} — ${wait}ms 후 재시도 (${attempt + 1}/${maxRetries})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

export function isRateLimitError(err: unknown): boolean {
  return axios.isAxiosError(err) && err.response?.status === 429;
}

export async function analyze(article: NewsArticle): Promise<Analysis> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const res = await callGemini(key, {
    contents: [{ parts: [{ text: buildPrompt(article) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
      maxOutputTokens: 1024,
      temperature: 0.3,
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text: string | undefined = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = res.data?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini 응답에 텍스트 없음 (finishReason: ${reason})`);
  }

  const input = JSON.parse(text) as Partial<Analysis>;
  return {
    summary: input.summary ?? "",
    importance: input.importance ?? "NORMAL",
    sentiment: input.sentiment ?? "neutral",
    category: input.category ?? "stock",
    related: Array.isArray(input.related) ? input.related : [],
    tags: Array.isArray(input.tags) ? input.tags : [],
  };
}
