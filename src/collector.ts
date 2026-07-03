import axios from "axios";
import { XMLParser } from "fast-xml-parser";

export interface NewsArticle {
  id: string; // 중복방지 키 (link 또는 guid)
  title: string;
  url: string;
  description: string; // RSS 요약 (AI 분석 입력)
  publishedAt: string; // ISO 문자열
  source: string;
  region: "kr" | "global";
  lang: "ko" | "en";
}

const parser = new XMLParser({ ignoreAttributes: false, trimValues: true });

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
};

interface RssSource {
  name: string;
  url: string;
  limit: number;
  region: "kr" | "global";
  lang: "ko" | "en";
}

// 국내: 한국경제 / 마켓: Investing.com 한국 / 글로벌: CNBC(영어 → AI 한국어화)
const RSS_SOURCES: RssSource[] = [
  { name: "한경 증권", url: "https://www.hankyung.com/feed/finance", limit: 6, region: "kr", lang: "ko" },
  { name: "한경 경제", url: "https://www.hankyung.com/feed/economy", limit: 3, region: "kr", lang: "ko" },
  { name: "Investing", url: "https://kr.investing.com/rss/news_25.rss", limit: 5, region: "kr", lang: "ko" },
  {
    name: "CNBC",
    url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135",
    limit: 5,
    region: "global",
    lang: "en",
  },
];

function pickText(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (v && typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"]).trim();
  }
  return "";
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchRss(src: RssSource): Promise<NewsArticle[]> {
  const res = await axios.get(src.url, {
    timeout: 10000,
    responseType: "text",
    headers: BROWSER_HEADERS,
  });
  const parsed = parser.parse(res.data);
  const rawItems = parsed?.rss?.channel?.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.slice(0, src.limit).map((it: Record<string, unknown>) => {
    const pub = pickText(it.pubDate);
    const url = pickText(it.link);
    const guid = pickText(it.guid);
    const desc = stripHtml(pickText(it.description)).slice(0, 400);
    return {
      id: url || guid || pickText(it.title),
      title: pickText(it.title),
      url,
      description: desc,
      publishedAt: pub ? new Date(pub).toISOString() : "",
      source: src.name,
      region: src.region,
      lang: src.lang,
    };
  });
}

export async function collectNews(): Promise<NewsArticle[]> {
  const results: NewsArticle[] = [];

  // 각 소스 독립 처리 — 하나 실패해도 나머지 진행
  for (const src of RSS_SOURCES) {
    try {
      const articles = await fetchRss(src);
      console.log(`✅ ${src.name}: ${articles.length}건`);
      results.push(...articles);
    } catch (err) {
      console.warn(`⚠️  ${src.name} 실패: ${(err as Error).message}`);
    }
  }

  // 제목 기준 중복 제거 (소스 간 동일 기사)
  const seen = new Set<string>();
  const deduped = results.filter((a) => {
    if (!a.title || seen.has(a.title)) return false;
    seen.add(a.title);
    return true;
  });

  if (deduped.length === 0) {
    throw new Error("뉴스 수집 실패 — 모든 소스에서 기사를 가져오지 못했습니다.");
  }

  return deduped;
}
