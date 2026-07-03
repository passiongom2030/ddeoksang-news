import Anthropic from "@anthropic-ai/sdk";
import type { NewsArticle } from "./collector.js";

const client = new Anthropic();

type TimeSlot = "morning" | "midday" | "close";

const TIME_LABELS: Record<TimeSlot, string> = {
  morning: "🌅 장 시작 브리핑",
  midday: "☀️ 오전 시장 요약",
  close: "🌙 장 마감 정리",
};

function buildNewsText(articles: NewsArticle[]): string {
  return articles
    .map((a, i) => `${i + 1}. [${a.source}] ${a.title}\n   ${a.description}`)
    .join("\n\n");
}

export async function generatePost(articles: NewsArticle[], timeSlot: TimeSlot): Promise<string> {
  const today = new Date().toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const newsText = buildNewsText(articles);
  const label = TIME_LABELS[timeSlot];

  const prompt = `다음은 오늘의 주식/금융 시장 뉴스입니다. 이를 한국어 Threads 포스트로 작성해주세요.

뉴스 목록:
${newsText}

요구사항:
- 포스트 제목: "${label} | ${today}"
- 핵심 이슈 3개를 불릿 포인트(•)로 요약
- 투자자에게 도움이 되는 인사이트 1-2줄 추가
- 해시태그: #주식 #시장동향 #글로벌증시 포함
- 전체 500자 이내
- 친근하고 이해하기 쉬운 톤 유지
- 투자 권유 문구는 절대 포함하지 말 것

포스트만 출력하세요. 설명이나 부가 텍스트 없이.`;

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("AI 응답에서 텍스트를 찾을 수 없습니다.");
  }

  return textBlock.text.trim();
}

export type { TimeSlot };
