import axios from "axios";
import type { NewsArticle } from "./collector.js";

export interface RelatedTicker {
  symbol: string;
  market: "STOCK" | "ETF" | "CRYPTO" | "INDEX";
  confidence: number; // 0-100
}

export interface Analysis {
  headline_ko: string;
  summary: string;
  importance: "HIGH" | "NORMAL" | "LOW";
  sentiment: "bullish" | "neutral" | "bearish";
  category: "stock" | "crypto" | "macro" | "fx" | "commodity";
  related: RelatedTicker[];
  tags: string[];
}

// 무료 한도: 2.5-flash-lite는 하루 20건뿐 → 한도 더 높은 2.5-flash 기본 사용
const MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// 뉴스 1건 분석 스키마 (배치 배열의 각 원소)
const ITEM_SCHEMA = {
  type: "OBJECT",
  properties: {
    idx: { type: "INTEGER", description: "입력 뉴스의 번호(순서 유지용)" },
    headline_ko: { type: "STRING", description: "기사 제목을 자연스러운 한국어 제목으로. 영어 기사는 번역." },
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
          confidence: { type: "INTEGER", description: "관련도 0~100 정수" },
        },
        required: ["symbol", "market", "confidence"],
      },
    },
    tags: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["idx", "headline_ko", "summary", "importance", "sentiment", "category", "related", "tags"],
};

const BATCH_SCHEMA = {
  type: "OBJECT",
  properties: { items: { type: "ARRAY", items: ITEM_SCHEMA } },
  required: ["items"],
};

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
        timeout: 30000,
      });
    } catch (err) {
      lastErr = err;
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      const retryable = status === 503 || status === 429 || status === 500;
      if (!retryable || attempt === maxRetries) throw err;
      const base = status === 429 ? 15000 : 1500; // 429는 분당 한도라 길게
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

function normalize(it: Partial<Analysis>): Analysis {
  return {
    headline_ko: it.headline_ko ?? "",
    summary: it.summary ?? "",
    importance: it.importance ?? "NORMAL",
    sentiment: it.sentiment ?? "neutral",
    category: it.category ?? "stock",
    related: Array.isArray(it.related) ? it.related : [],
    tags: Array.isArray(it.tags) ? it.tags : [],
  };
}

/**
 * 여러 뉴스를 단 1번의 Gemini 호출로 배치 분석한다 (분당 한도 부담 최소화).
 * 반환 배열은 입력 순서와 정렬됨. 특정 항목이 누락되면 그 자리에 null.
 */
export async function analyzeBatch(articles: NewsArticle[]): Promise<(Analysis | null)[]> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");
  if (articles.length === 0) return [];

  const list = articles
    .map(
      (a, i) =>
        `[${i}] 제목: ${a.title}\n    출처: ${a.source} (${a.lang === "en" ? "영어" : "한국어"})\n    내용: ${a.description || "(요약 없음 — 제목 기반)"}`
    )
    .join("\n\n");

  const prompt = `아래 ${articles.length}개의 주식/금융 뉴스를 각각 투자자 관점에서 분석해 items 배열로 반환하세요.

규칙:
- 각 항목의 idx는 입력 번호와 동일하게(순서 유지).
- headline_ko, summary는 반드시 한국어. 영어 기사는 번역.
- importance: 지수/대형주/정책 등 시장 파급력이 크면 HIGH.
- related: 명확히 관련된 종목/지수만, confidence 0~100 정수. 애매하면 빈 배열.
- tags: 짧은 한국어 키워드 2-4개.
- 특정 종목 매수/매도 권유 금지.

뉴스 목록:
${list}`;

  const res = await callGemini(key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: BATCH_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 0.3,
    },
  });

  const text: string | undefined = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const reason = res.data?.candidates?.[0]?.finishReason ?? "unknown";
    throw new Error(`Gemini 응답에 텍스트 없음 (finishReason: ${reason})`);
  }

  const parsed = JSON.parse(text) as { items?: Array<Partial<Analysis> & { idx?: number }> };
  const items = Array.isArray(parsed.items) ? parsed.items : [];

  // idx로 매핑, 없으면 순서로 폴백
  const byIdx = new Map<number, Partial<Analysis>>();
  items.forEach((it, i) => {
    const key = typeof it.idx === "number" ? it.idx : i;
    byIdx.set(key, it);
  });

  return articles.map((_, i) => {
    const it = byIdx.get(i);
    if (!it || !it.summary) return null;
    return normalize(it);
  });
}
