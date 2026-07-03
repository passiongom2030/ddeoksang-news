import axios, { AxiosError } from "axios";

function getWebhookUrl(): string {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    throw new Error(
      "SLACK_WEBHOOK_URL이 설정되지 않았습니다. .env 파일에 Slack Incoming Webhook 주소를 추가하세요."
    );
  }
  return url;
}

/**
 * Slack Incoming Webhook으로 텍스트 메시지를 보낸다.
 * webhook 주소 하나만 있으면 해당 채널에 자동 게시된다.
 */
export async function postToSlack(text: string): Promise<void> {
  const url = getWebhookUrl();

  try {
    console.log("📤 Slack에 게시 중...");
    await axios.post(url, { text }, { timeout: 10000 });
    console.log("✅ Slack 게시 완료");
  } catch (err) {
    const axiosErr = err as AxiosError;
    const detail = JSON.stringify(axiosErr.response?.data ?? axiosErr.message);
    throw new Error(`Slack 게시 실패: ${detail}`);
  }
}
