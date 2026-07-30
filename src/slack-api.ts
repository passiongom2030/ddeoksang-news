import axios from "axios";

function getBotToken(): string {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN이 설정되지 않았습니다.");
  return token;
}

export interface SlackThreadMessage {
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
}

/** 봇 자신의 user id (auth.test로 조회, 매 호출 캐시 없이 확인 — 저비용 API) */
export async function getBotUserId(): Promise<string> {
  const { data } = await axios.post(
    "https://slack.com/api/auth.test",
    {},
    { headers: { Authorization: `Bearer ${getBotToken()}` } }
  );
  if (!data.ok) throw new Error(`auth.test 실패: ${data.error}`);
  return data.user_id as string;
}

/** 스레드 전체 메시지를 시간순으로 가져온다 (봇이 초대된 채널이어야 함). */
export async function fetchThreadReplies(
  channel: string,
  threadTs: string
): Promise<SlackThreadMessage[]> {
  const { data } = await axios.get("https://slack.com/api/conversations.replies", {
    headers: { Authorization: `Bearer ${getBotToken()}` },
    params: { channel, ts: threadTs, limit: 50 },
  });
  if (!data.ok) throw new Error(`conversations.replies 실패: ${data.error}`);
  return (data.messages ?? []) as SlackThreadMessage[];
}

/** 스레드에 답글을 단다. */
export async function postThreadReply(
  channel: string,
  threadTs: string,
  text: string
): Promise<void> {
  const { data } = await axios.post(
    "https://slack.com/api/chat.postMessage",
    { channel, thread_ts: threadTs, text },
    { headers: { Authorization: `Bearer ${getBotToken()}` } }
  );
  if (!data.ok) throw new Error(`chat.postMessage 실패: ${data.error}`);
}
