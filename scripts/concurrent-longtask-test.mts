/**
 * Real production multi-conversation concurrency probe.
 *
 * Creates N conversations, enqueues one bounded task per conversation, then
 * polls each hosted turn until terminal or the per-run timeout. Reports
 * status/stage/error for every session so stability issues surface.
 *
 * Usage:
 *   HERMES_TEST_USER=... HERMES_TEST_PASSWORD=... \
 *     pnpm tsx scripts/concurrent-longtask-test.mts [count] [maxSeconds]
 */
import { MobileAuthApiClient } from "../src/auth/mobile-auth";
import { HermesApiClient } from "../src/api/HermesApiClient";
import { HermesCloudApi } from "../src/api/HermesCloudApi";

const user = process.env.HERMES_TEST_USER || "";
const password = process.env.HERMES_TEST_PASSWORD || "";
if (!user || !password) throw new Error("credentials missing");

const COUNT = Number(process.argv[2] || 3);
const MAX_SECONDS = Number(process.argv[3] || 900);
if (!Number.isFinite(COUNT) || COUNT < 1 || COUNT > 20) throw new Error("count must be 1..20");
if (!Number.isFinite(MAX_SECONDS) || MAX_SECONDS < 30 || MAX_SECONDS > 3600) throw new Error("maxSeconds 30..3600");

const BASE = "https://daxueshenmai.top";
const auth = new MobileAuthApiClient(BASE);
const session = await auth.login(user, password, {
  id: `codex-concurrency-${Date.now()}`,
  name: "iPhone",
  model: "iPhone",
  osVersion: "iOS 18",
  appVersion: "2.0.0-beta.1",
});
let currentSession = session;
let client = new HermesApiClient(BASE, currentSession.accessToken);
let cloud = new HermesCloudApi(client);

// The mobile refresh token rotates on every use. When multiple pending
// conversations hit 401 in the same poll, concurrent refreshes race and the
// second one presents an already-rotated token -> "Invalid refresh token".
// Serialize all refreshes through one promise chain.
let refreshInFlight: Promise<void> | null = null;
async function refreshSessionIfNeeded() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshed = await auth.refresh(currentSession.refreshToken);
    currentSession = refreshed;
    client = new HermesApiClient(BASE, currentSession.accessToken);
    cloud = new HermesCloudApi(client);
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

const now = Date.now();
const conversations: Array<{ id: string; turnId: string; prompt: string; status: string; stage: string; error: string; elapsed: number }> = [];

async function createAndEnqueue(index: number) {
  const suffix = `${now}-${index}`;
  const prompt = `并发稳定性探针 ${index}：请完成一个简短任务：1) 在 /var/tmp/ios-concurrent-${suffix} 下创建目录；2) 写入 concurrency.txt（包含时间、序号和三个检查点）；3) 读回并返回摘要。`;
  const { conversation } = await cloud.createConversation("default", `并发探针 ${index}`);
  const id = conversation.id;
  if (!id) throw new Error(`conversation ${index} missing id`);
  const enqueue = await cloud.enqueueHostedTurn(id, {
    requestId: `conc-${suffix}`,
    turnId: `turn-conc-${suffix}`,
    message: {
      id: `msg-conc-${suffix}`,
      role: "user",
      content: prompt,
      created_at: now,
      name: "你",
      status: "completed",
    },
    profiles: ["default"],
    recentMessages: [],
  });
  const hostedTurn = (enqueue.hosted_turn || {}) as Record<string, unknown>;
  const turnId = String(hostedTurn.turn_id || (enqueue as unknown as Record<string, unknown>).turn_id || (enqueue as unknown as Record<string, unknown>).turnId || "");
  conversations.push({ id, turnId, prompt, status: "queued", stage: "accepted", error: "", elapsed: 0 });
  console.log(`[${index}] conversation=${id} turn=${turnId}`);
}

for (let i = 1; i <= COUNT; i++) await createAndEnqueue(i);

const deadline = Date.now() + MAX_SECONDS * 1000;
const terminal = new Set(["completed", "failed", "cancelled"]);
while (Date.now() < deadline) {
  const pending = conversations.filter((c) => !terminal.has(c.status));
  if (!pending.length) break;
  await Promise.all(pending.map(async (c) => {
    try {
      const { conversation } = await cloud.getConversation(c.id);
      const turns = (conversation.hosted_turns || {}) as Record<string, any>;
      const run = turns[c.turnId];
      if (!run) return;
      c.status = run.status || c.status;
      c.stage = run.stage || c.stage;
      c.error = run.error || "";
      c.elapsed = Math.round((Date.now() - now) / 1000);
    } catch (e: any) {
      const message = `${e?.message || e}`;
      if (/401|Unauthorized/.test(message)) {
        try {
          await refreshSessionIfNeeded();
          const { conversation: retryConversation } = await cloud.getConversation(c.id);
          const retryTurns = (retryConversation.hosted_turns || {}) as Record<string, any>;
          const retryRun = retryTurns[c.turnId];
          if (retryRun) {
            c.status = retryRun.status || c.status;
            c.stage = retryRun.stage || c.stage;
            c.error = retryRun.error || "";
            c.elapsed = Math.round((Date.now() - now) / 1000);
            return;
          }
        } catch (refreshError: any) {
          c.error = `refresh_error: ${refreshError?.message || refreshError}`;
          return;
        }
      }
      c.error = `poll_error: ${message}`;
    }
  }));
  console.log(`\n[${Math.round((Date.now() - now) / 1000)}s] ` + conversations.map((c) => `${c.turnId.slice(-8)}:${c.status}/${c.stage}`).join("  "));
  await new Promise((r) => setTimeout(r, 15000));
}

console.log("\n===== CONCURRENCY SUMMARY =====");
for (const c of conversations) {
  console.log(JSON.stringify({ turn: c.turnId, status: c.status, stage: c.stage, error: c.error?.slice(0, 300), elapsed: c.elapsed }, null, 2));
}
const succeeded = conversations.filter((c) => c.status === "completed").length;
const failed = conversations.filter((c) => c.status === "failed").length;
const pending = conversations.filter((c) => !terminal.has(c.status)).length;
console.log(`completed=${succeeded} failed=${failed} pending=${pending} total=${conversations.length}`);
if (pending > 0) process.exitCode = 2;
if (failed > 0) process.exitCode = 1;
