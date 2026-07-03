import "dotenv/config";
import { collectNews } from "./collector.js";
import { analyzeBatch, isRateLimitError } from "./analyzer.js";
import { formatAnalyzedItem } from "./format.js";
import { postToSlack } from "./slack.js";
import { loadSeen, isNew, markSeen, saveSeen } from "./state.js";
import { startScheduler } from "./scheduler.js";

const MAX_ITEMS_PER_RUN = Number(process.env.MAX_ITEMS_PER_RUN ?? 5);
const DRY_RUN = !!process.env.DRY_RUN; // 채널에 안 쏘고 콘솔 미리보기 (상태도 저장 안 함)

function checkEnv(): void {
  const required = ["GEMINI_API_KEY", "SLACK_WEBHOOK_URL"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error("❌ 다음 환경변수가 .env 파일에 없습니다:");
    for (const k of missing) console.error(`   • ${k}`);
    console.error("\n.env.example 파일을 참고해 .env 파일을 생성하세요.");
    process.exit(1);
  }
}

export async function runBot(): Promise<void> {
  const articles = await collectNews();

  const seen = loadSeen();
  const fresh = articles.filter((a) => isNew(seen, a.id)).slice(0, MAX_ITEMS_PER_RUN);

  if (fresh.length === 0) {
    console.log("🟢 새 뉴스 없음 — 게시 스킵");
    return;
  }
  console.log(`🆕 신규 ${fresh.length}건 처리 (전체 ${articles.length}건 중)\n`);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 단 1번의 Gemini 호출로 전체 배치 분석 (분당 한도 부담 최소화)
  let analyses: (Awaited<ReturnType<typeof analyzeBatch>>[number])[];
  try {
    analyses = await analyzeBatch(fresh);
  } catch (err) {
    if (isRateLimitError(err)) {
      console.warn("⚠️  Gemini 한도(429) — 이번 실행 스킵, 다음 실행에서 재시도");
      return; // 아무것도 게시·기록하지 않음
    }
    console.warn(`⚠️  배치 분석 실패 — 이번 실행 스킵: ${(err as Error).message}`);
    return;
  }

  let posted = 0;
  for (let i = 0; i < fresh.length; i++) {
    const a = fresh[i];
    const analysis = analyses[i];
    if (!analysis) {
      // 개별 항목 분석 누락 → 이번엔 게시·기록 안 함 (다음 실행 재시도)
      continue;
    }

    const message = formatAnalyzedItem(a, analysis);

    if (DRY_RUN) {
      console.log("\n──────────────\n" + message + "\n──────────────");
      continue; // 미리보기: 게시·상태저장 안 함
    }

    await postToSlack(message);
    markSeen(seen, a.id);
    posted++;
    await sleep(1200); // Slack 게시 간격
  }

  console.log(`\n게시 ${posted}건`);

  if (DRY_RUN) {
    console.log("\n🔎 DRY_RUN — 게시/상태저장 없음");
    return;
  }

  saveSeen(seen);
  console.log("\n✅ 완료!");
}

async function main(): Promise<void> {
  checkEnv();

  const command = process.argv[2];

  if (command === "schedule") {
    startScheduler();
    // 프로세스가 종료되지 않도록 유지
    await new Promise(() => {});
  } else {
    console.log("🤖 주식 뉴스 봇 시작\n");
    await runBot();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
