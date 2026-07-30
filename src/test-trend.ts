/**
 * /동향 엔드포인트 로컬 검증 스크립트
 *
 * 사용:
 *   npx tsx src/test-trend.ts              # 야후 조회 + 포맷
 *   npx tsx src/test-trend.ts --verify     # 서명 검증(401/200) 단위 테스트
 *   npx tsx src/test-trend.ts --mock-ack   # ack → response_url 지연 응답 mock
 */
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fetchAllQuotes, clearQuoteCache } from "./yahoo.js";
import { formatTrendMessage } from "./format.js";
import { verifySlackSignature } from "./slack-verify.js";
import { TREND_SYMBOLS } from "./trend-symbols.js";

function sign(secret: string, timestamp: string, body: string): string {
  const base = `v0:${timestamp}:${body}`;
  return `v0=${createHmac("sha256", secret).update(base, "utf8").digest("hex")}`;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function testYahoo(): Promise<void> {
  console.log("=== Yahoo 5d chart 조회 ===\n");
  clearQuoteCache();
  const rows = await fetchAllQuotes();
  console.log(formatTrendMessage(rows));
  console.log("\n--- raw ---");
  for (const row of rows) {
    if (row.ok) {
      console.log(
        `${row.label} (${row.symbol}): price=${row.price} prev=${row.prevClose} change=${row.changePct.toFixed(2)}%`
      );
    } else {
      console.log(`${row.label} (${row.symbol}): FAIL — ${row.error}`);
    }
  }
  const failed = rows.filter((r) => !r.ok);
  console.log(`\n심볼 ${TREND_SYMBOLS.length}개 중 성공 ${rows.length - failed.length}, 실패 ${failed.length}`);
}

function testVerify(): void {
  console.log("=== Slack 서명 검증 ===\n");
  const secret = "test_signing_secret";
  const body = "token=x&command=%2F%EB%8F%99%ED%96%A5&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT%2FB%2Fx";
  const ts = String(Math.floor(Date.now() / 1000));

  const good = sign(secret, ts, body);
  const ok = verifySlackSignature({
    signingSecret: secret,
    signature: good,
    timestamp: ts,
    rawBody: body,
  });
  console.log(`valid signature → ${ok ? "PASS (accept)" : "FAIL"}`);

  const bad = verifySlackSignature({
    signingSecret: secret,
    signature: "v0=deadbeef",
    timestamp: ts,
    rawBody: body,
  });
  console.log(`invalid signature → ${!bad ? "PASS (reject)" : "FAIL"}`);

  const stale = verifySlackSignature({
    signingSecret: secret,
    signature: sign(secret, "1000000000", body),
    timestamp: "1000000000",
    rawBody: body,
  });
  console.log(`stale timestamp → ${!stale ? "PASS (reject)" : "FAIL"}`);

  if (!ok || bad || stale) {
    process.exitCode = 1;
  }
}

async function testMockAck(): Promise<void> {
  console.log("=== mock ack + delayed response_url ===\n");
  const secret = "test_signing_secret";

  // response_url을 받는 mock Slack 서버
  let delayedBody: string | null = null;
  const slackMock = createServer(async (req, res) => {
    const body = await readBody(req);
    delayedBody = body;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  await new Promise<void>((resolve) => slackMock.listen(0, "127.0.0.1", resolve));
  const slackPort = (slackMock.address() as { port: number }).port;
  const responseUrl = `http://127.0.0.1:${slackPort}/response`;

  // 우리 엔드포인트와 동일한 흐름의 로컬 핸들러
  const app = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }
    const rawBody = await readBody(req);
    const signature = req.headers["x-slack-signature"] as string | undefined;
    const timestamp = req.headers["x-slack-request-timestamp"] as string | undefined;

    if (!verifySlackSignature({ signingSecret: secret, signature, timestamp, rawBody })) {
      res.writeHead(401);
      res.end("Invalid signature");
      return;
    }

    const params = new URLSearchParams(rawBody);
    const url = params.get("response_url");
    if (!url) {
      res.writeHead(400);
      res.end("Missing response_url");
      return;
    }

    // 즉시 ack
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ response_type: "ephemeral", text: "📊 동향 조회 중..." }));

    // 지연 응답 (실서버의 waitUntil에 해당)
    void (async () => {
      const rows = await fetchAllQuotes();
      const text = formatTrendMessage(rows);
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          replace_original: true,
          text,
        }),
      });
    })();
  });

  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const appPort = (app.address() as { port: number }).port;

  const form = new URLSearchParams({
    token: "x",
    command: "/동향",
    response_url: responseUrl,
    user_id: "U123",
    text: "",
  }).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const signature = sign(secret, ts, form);

  const t0 = Date.now();
  const ackRes = await fetch(`http://127.0.0.1:${appPort}/api/slack-trend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Signature": signature,
      "X-Slack-Request-Timestamp": ts,
    },
    body: form,
  });
  const ackMs = Date.now() - t0;
  const ackJson = await ackRes.json();
  console.log(`ack status=${ackRes.status} in ${ackMs}ms:`, ackJson);

  // 잘못된 서명 → 401
  const badRes = await fetch(`http://127.0.0.1:${appPort}/api/slack-trend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Slack-Signature": "v0=bad",
      "X-Slack-Request-Timestamp": ts,
    },
    body: form,
  });
  console.log(`bad signature status=${badRes.status} (expect 401)`);

  // 지연 응답 대기
  const deadline = Date.now() + 20_000;
  while (!delayedBody && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  if (!delayedBody) {
    console.error("FAIL: delayed response never arrived");
    process.exitCode = 1;
  } else {
    const parsed = JSON.parse(delayedBody) as { text?: string };
    console.log("\n--- delayed message ---\n");
    console.log(parsed.text);
    console.log("\nPASS: ack + delayed response_url flow OK");
  }

  if (ackRes.status !== 200 || badRes.status !== 401 || ackMs > 3000) {
    console.error(`FAIL: ack checks (status=${ackRes.status}, bad=${badRes.status}, ms=${ackMs})`);
    process.exitCode = 1;
  }

  await new Promise<void>((resolve, reject) => app.close((e) => (e ? reject(e) : resolve())));
  await new Promise<void>((resolve, reject) => slackMock.close((e) => (e ? reject(e) : resolve())));
}

const args = process.argv.slice(2);
const mode = args.includes("--verify")
  ? "verify"
  : args.includes("--mock-ack")
    ? "mock-ack"
    : "yahoo";

if (mode === "verify") {
  testVerify();
} else if (mode === "mock-ack") {
  await testMockAck();
} else {
  await testYahoo();
}
