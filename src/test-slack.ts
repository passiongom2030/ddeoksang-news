import "dotenv/config";
import { postToSlack } from "./slack.js";

// Slack 연결 확인용 샘플 메시지 (실제 뉴스 X)
const sample = `📈 *최신 뉴스* | 연결 테스트

• 삼성전자, 반도체 업황 회복 기대에 강세
• SK하이닉스, HBM 수요 확대에 장중 신고가
• 뉴욕증시, 미 고용지표 둔화에 3대 지수 상승 마감
• 엔비디아, AI 칩 수요 지속에 시총 사상 최고

_이 메시지가 보이면 Slack 연결 성공입니다._`;

postToSlack(sample)
  .then(() => console.log("🎉 테스트 완료 — Slack 채널을 확인하세요."))
  .catch((err) => {
    console.error("❌", (err as Error).message);
    process.exit(1);
  });
