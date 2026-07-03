import cron from "node-cron";
import { runBot } from "./index.js";

// 실행 주기 (KST). 우선 30분마다로 시작 — 나중에 조정.
const CRON_EXPR = "*/30 * * * *";

export function startScheduler(): void {
  console.log(`⏰ 스케줄러 시작 — ${CRON_EXPR} (30분마다)\n`);
  cron.schedule(CRON_EXPR, async () => {
    console.log(`\n🔔 [${new Date().toLocaleString("ko-KR")}] 뉴스 수집 실행`);
    try {
      await runBot();
    } catch (err) {
      console.error("스케줄 실행 중 오류:", (err as Error).message);
    }
  });
  console.log("✅ 스케줄러 대기 중... (Ctrl+C로 종료)\n");
}
