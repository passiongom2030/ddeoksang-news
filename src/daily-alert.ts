import "dotenv/config";
import { fetchAllQuotes } from "./yahoo.js";
import { formatTrendMessage } from "./format.js";
import { postToSlack } from "./slack.js";

/**
 * 장마감 후 관심종목 거래량/등락률 요약을 Slack으로 보낸다.
 * GitHub Actions cron이 평일 KST 15:30 이후 실행 (daily-stock-alert.yml).
 */
async function main(): Promise<void> {
  const rows = await fetchAllQuotes();
  const message = formatTrendMessage(rows, "📊 *오늘 관심종목 요약*");
  await postToSlack(message, { username: "stock-news-bot", icon_emoji: ":bar_chart:" });
  console.log("✅ 일일 관심종목 알림 게시 완료");
}

main().catch((err) => {
  console.error("일일 알림 실패:", err);
  process.exit(1);
});
