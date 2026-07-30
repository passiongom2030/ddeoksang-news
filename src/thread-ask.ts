import axios from "axios";
import { buildStockDataSummary } from "./stock-lookup.js";
import { fetchThreadReplies, type SlackThreadMessage } from "./slack-api.js";

const MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
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

function buildTranscript(messages: SlackThreadMessage[], botUserId: string): string {
  return messages
    .map((m) => {
      const speaker = m.bot_id || m.user === botUserId ? "봇" : "사용자";
      return `${speaker}: ${stripMentions(m.text)}`;
    })
    .join("\n");
}

/**
 * 스레드 전체 맥락(conversations.replies로 매번 새로 조회 — 별도 DB 없이 Slack이 상태 저장소 역할)을
 * 바탕으로 마지막 사용자 질문에 답한다.
 */
export async function answerInThread(channel: string, threadTs: string, botUserId: string): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY가 설정되지 않았습니다.");

  const messages = await fetchThreadReplies(channel, threadTs);
  const transcript = buildTranscript(messages, botUserId);

  const fullText = messages.map((m) => stripMentions(m.text)).join(" ");
  const dataSummary = await buildStockDataSummary(fullText);

  const prompt = `아래는 Slack 스레드 대화 기록입니다:
${transcript}

관련 종목 실시간 데이터:
${dataSummary}

위 대화의 가장 마지막 "사용자" 메시지에 대해 답변하세요.

규칙 (반드시 지킬 것):
- 이전 대화 맥락을 참고해서 자연스럽게 이어서 답할 것 (예: "그것보다는?" 같은 축약된 질문도 앞 맥락으로 해석).
- 데이터를 설명하거나 종목 간 비교만 할 것.
- 매수/매도 판단, 투자 의견, "사세요/파세요/좋아 보입니다" 같은 표현은 절대 하지 말 것.
- 데이터에 없는 항목(예: 특정 지표)을 물으면 없다고 정직하게 답할 것.
- 판단이 필요한 질문이면 "그건 데이터로 답할 수 있는 범위가 아니에요"라고 답할 것.
- 2~3문장, 한국어, Slack 메시지에 어울리는 간결한 톤.`;

  const res = await callGemini(key, {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 2048, temperature: 0.2 },
  });

  const text: string | undefined = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
  return text?.trim() ?? "답변을 생성하지 못했습니다.";
}
