import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { MobileAuthApiClient } from '../src/auth/mobile-auth';
import { HermesApiClient } from '../src/api/HermesApiClient';
import { HermesCloudApi } from '../src/api/HermesCloudApi';
import { consumeHostedConversationEvents } from '../src/api/hosted-conversation-events';
import type { SingleConversation } from '../src/api/cloud/contracts';

const origin = 'https://daxueshenmai.top';
const user = process.env.HERMES_AUDIT_TEST_USER || '';
const password = process.env.HERMES_AUDIT_TEST_PASSWORD || '';
if (!user || !password) throw new Error('latency test credentials are not configured');
const prewarmWaitMs = Math.max(
  0,
  Number(process.env.HERMES_AUDIT_PREWARM_WAIT_MS || 8_000),
);
const firstContent = process.env.HERMES_AUDIT_MESSAGE || '\u4f60\u597d';
const secondContent = process.env.HERMES_AUDIT_SECOND_MESSAGE
  || '\u8bf7\u7528\u4e00\u53e5\u8bdd\u56de\u7b54\uff1a\u6536\u5230';
const turnTimeoutMs = Math.max(
  5_000,
  Number(process.env.HERMES_AUDIT_TURN_TIMEOUT_MS || 60_000),
);
const debugEvents = process.env.HERMES_AUDIT_DEBUG_EVENTS === '1';
const keepConversation = process.env.HERMES_AUDIT_KEEP_CONVERSATION === '1';
const preopenStream = process.env.HERMES_AUDIT_PREOPEN_STREAM === '1';
const oneTurnOnly = process.env.HERMES_AUDIT_ONE_TURN === '1';
const createIfMissing = process.env.HERMES_AUDIT_CREATE_IF_MISSING === '1';
const testCustomModelOnly = process.env.HERMES_AUDIT_TEST_CUSTOM_MODEL === '1';
const saveCustomModel = process.env.HERMES_AUDIT_SAVE_CUSTOM_MODEL === '1';
const upstreamApiKey = process.env.HERMES_AUDIT_UPSTREAM_API_KEY || '';
const upstreamBaseUrl = process.env.HERMES_AUDIT_UPSTREAM_BASE_URL || '';
const upstreamModel = process.env.HERMES_AUDIT_UPSTREAM_MODEL || '';
const upstreamReasoningEffort = process.env.HERMES_AUDIT_UPSTREAM_REASONING_EFFORT || 'medium';

const device = {
  id: `codex-ios-audit-${randomUUID()}`,
  name: 'iPhone',
  model: 'iPhone',
  osVersion: 'iOS 18',
  appVersion: '2.0.0-beta.1',
};
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const main = async () => {
  const auth = new MobileAuthApiClient(origin, fetch, 20_000);
  const session = await auth.login(user, password, device);
  const client = new HermesApiClient(origin, session.accessToken, fetch, fetch);
  const cloud = new HermesCloudApi(client);
  if (saveCustomModel) {
    if (!upstreamApiKey || !upstreamBaseUrl || !upstreamModel) {
      throw new Error('custom model save configuration is incomplete');
    }
    await cloud.saveCustomModel({
      apiKey: upstreamApiKey,
      apiKeyAction: 'replace',
      apiMode: 'chat_completions',
      baseUrl: upstreamBaseUrl,
      contextLength: 0,
      model: upstreamModel,
      reasoningEffort: upstreamReasoningEffort,
    });
    console.error(JSON.stringify({
      customModelSaved: {
        baseUrl: upstreamBaseUrl,
        model: upstreamModel,
        apiMode: 'chat_completions',
      },
    }));
  }
  if (testCustomModelOnly) {
    if (!upstreamApiKey || !upstreamBaseUrl || !upstreamModel) {
      throw new Error('custom model test configuration is incomplete');
    }
    const result = await cloud.testCustomModel({
      apiKey: upstreamApiKey,
      apiKeyAction: 'replace',
      apiMode: 'chat_completions',
      baseUrl: upstreamBaseUrl,
      contextLength: 0,
      model: upstreamModel,
      reasoningEffort: upstreamReasoningEffort,
    });
    console.log(JSON.stringify({ customModelTest: result }));
    return;
  }
  const stamp = Date.now().toString(36);
  let conversation: SingleConversation;
  if (createIfMissing) {
    conversation = {
      account_generation: session.account.accountGeneration,
      id: `chat_${randomUUID().replaceAll('-', '').slice(0, 24)}`,
      messages: [],
      profile: 'default',
      runtime_sessions: {},
      title: `iOS latency audit ${stamp}`,
    };
  } else {
    const created = await cloud.createConversation(
      'default',
      `iOS latency audit ${stamp}`,
    );
    conversation = created.conversation;
  }
  if (debugEvents) {
    console.error(JSON.stringify({
      conversationScope: {
        id: conversation.id,
        accountGeneration: conversation.account_generation,
        profile: conversation.profile,
        runtimeSessions: conversation.runtime_sessions,
      },
    }));
  }

  const measure = async (content: string) => {
    const turnId = `codex-ios-audit-turn-${randomUUID()}`;
    const requestId = `codex-ios-audit-request-${randomUUID()}`;
    const messageId = `codex-ios-audit-message-${randomUUID()}`;
    const sendStart = performance.now();
    const sendStartWallMs = Date.now();
    const controller = new AbortController();
    let firstAt: number | null = null;
    let firstThinkingAt: number | null = null;
    let fullAt: number | null = null;
    let terminalAt: number | null = null;
    let eventCount = 0;
    let firstEventType = '';
    let firstContentDeliveryLagMs: number | null = null;
    let fullDeliveryLagMs: number | null = null;
    let terminalDeliveryLagMs: number | null = null;
    const firstOccurredAtByType: Record<string, number> = {};
    const lastOccurredAtByType: Record<string, number> = {};
    const stageAt: Record<string, number> = {};
    const openStream = () => consumeHostedConversationEvents(
      cloud,
      conversation.id,
      0,
      session.account.accountGeneration,
      controller.signal,
      (frame) => {
        const receivedAt = performance.now();
        let shouldAbortAfterFrame = false;
        for (const event of frame.events) {
          if (event.turn_id !== turnId) continue;
          if (debugEvents) {
            console.error(JSON.stringify({
              eventType: event.event_type,
              roleStage: event.role_stage,
              textLength: typeof event.payload?.text === 'string'
                ? event.payload.text.length
                : 0,
              status: event.payload?.status,
            }));
          }
          eventCount += 1;
          const occurredAt = Number(event.occurred_at);
          const deliveryLagMs = Number.isFinite(occurredAt)
            ? Date.now() - occurredAt
            : null;
          if (
            Number.isFinite(occurredAt)
          ) {
            if (firstOccurredAtByType[event.event_type] === undefined) {
              firstOccurredAtByType[event.event_type] = occurredAt;
            }
            lastOccurredAtByType[event.event_type] = occurredAt;
          }
          if (
            (event.role_stage === 'chat' || event.role_stage === 'turn')
            && stageAt[event.event_type] === undefined
          ) {
            stageAt[event.event_type] = receivedAt - sendStart;
          }
          if (event.event_type === 'turn.completed') {
            terminalAt = receivedAt;
            terminalDeliveryLagMs = deliveryLagMs;
            shouldAbortAfterFrame = true;
            continue;
          }
          if (event.role_stage !== 'chat') continue;
          const payload = event.payload || {};
          const text = typeof payload.text === 'string' ? payload.text : '';
          if (
            firstThinkingAt === null
            && event.event_type === 'thinking.delta'
            && text.length > 0
          ) {
            firstThinkingAt = receivedAt;
          }
          if (
            firstAt === null
            && event.event_type === 'message.delta'
            && text.length > 0
          ) {
            firstAt = receivedAt;
            firstEventType = event.event_type;
            firstContentDeliveryLagMs = deliveryLagMs;
          }
          if (
            fullAt === null
            && event.event_type === 'message.completed'
          ) {
            fullAt = receivedAt;
            fullDeliveryLagMs = deliveryLagMs;
          }
        }
        if (shouldAbortAfterFrame) controller.abort();
      },
      undefined,
      5_000,
    ).catch((error: unknown) => {
      if (!controller.signal.aborted) throw error;
      return 0;
    });
    let preopenedStreamFailure = false;
    const preopenedStream = preopenStream
      ? openStream().catch((error: unknown) => {
        preopenedStreamFailure = true;
        if (debugEvents) {
          console.error(JSON.stringify({
            streamBeforeEnqueueError: error instanceof Error
              ? `${error.name}: ${error.message}`
              : String(error),
          }));
        }
        return 0;
      })
      : null;
    const response = await cloud.enqueueHostedTurn(conversation.id, {
      requestId,
      turnId,
      message: {
        id: messageId,
        role: 'user',
        name: 'You',
        sender_id: 'account-owner',
        sender_name: 'You',
        content,
        status: 'completed',
        kind: 'message',
        created_at: Date.now(),
        updated_at: Date.now(),
        meta: { runtime_turn_id: turnId },
      },
      recentMessages: [],
      profiles: ['default'],
      attachmentIds: [],
      createConversationIfMissing: createIfMissing,
      conversationProfile: 'default',
      conversationTitle: conversation.title,
      deliveryContext: '',
    });
    const acceptedAt = performance.now();
    const streamPromise = preopenedStream
      && !preopenedStreamFailure
      ? preopenedStream
      : openStream();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new Error('timed out waiting for hosted turn'));
      }, turnTimeoutMs);
    });
    try {
      await Promise.race([streamPromise, timeout]);
    } catch (error) {
      console.error(JSON.stringify({
        timeoutMeasurement: {
          enqueueMs: Number((acceptedAt - sendStart).toFixed(2)),
          firstMs: firstAt === null ? null : Number((firstAt - sendStart).toFixed(2)),
          fullMs: fullAt === null ? null : Number((fullAt - sendStart).toFixed(2)),
          terminalMs: terminalAt === null
            ? null
            : Number((terminalAt - sendStart).toFixed(2)),
          eventCount,
          stageAt: Object.fromEntries(
            Object.entries(stageAt).map(([key, value]) => [key, Number(value.toFixed(2))]),
          ),
          accepted: response.accepted,
          routeMode: response.route?.mode,
        },
      }));
      try {
        const latest = await cloud.getConversation(conversation.id);
        const run = latest.conversation.hosted_turns?.[turnId] as Record<string, unknown> | undefined;
        const roleEvents = run?.role_events as Record<string, Record<string, unknown>> | undefined;
        const chat = roleEvents?.chat;
        console.error(JSON.stringify({
          timeoutSnapshot: {
            status: run?.status,
            stage: run?.stage,
            model: chat?.actual_model,
            provider: chat?.actual_provider,
            modelStartedAt: chat?.model_started_at,
            firstTokenAt: chat?.first_token_at,
            retryAttempt: chat?.model_retry_attempt,
            retryMaxAttempts: chat?.model_retry_max_attempts,
            error: run?.error,
          },
        }));
      } catch {
        // The timeout itself is the primary measurement failure.
      }
      throw error;
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
    let serverTiming: Record<string, unknown> | undefined;
    try {
      const latest = await cloud.getConversation(conversation.id);
      const run = latest.conversation.hosted_turns?.[turnId] as Record<string, unknown> | undefined;
      const roleEvents = run?.role_events as Record<string, Record<string, unknown>> | undefined;
      const chat = roleEvents?.chat;
      if (chat) {
        serverTiming = {
          runCreatedAt: run?.created_at,
          runStartedAt: run?.started_at,
          requestAcceptedAt: run?.request_accepted_at,
          modelStartedAt: chat.model_started_at,
          firstTokenAt: chat.first_token_at,
          completedAt: chat.completed_at,
          runToModelStartedMs: run?.created_at && chat.model_started_at
            ? Number(chat.model_started_at) - Number(run.created_at)
            : null,
          acceptedToModelStartedMs: run?.request_accepted_at && chat.model_started_at
            ? Number(chat.model_started_at) - Number(run.request_accepted_at)
            : null,
          modelStartedMs: chat.model_started_at
            ? Number(chat.model_started_at) - sendStartWallMs
            : null,
          firstTokenMs: chat.first_token_at
            ? Number(chat.first_token_at) - sendStartWallMs
            : null,
          completedMs: chat.completed_at
            ? Number(chat.completed_at) - sendStartWallMs
            : null,
          modelFirstTokenDeltaMs: chat.model_started_at && chat.first_token_at
            ? Number(chat.first_token_at) - Number(chat.model_started_at)
            : null,
        };
      }
    } catch {
      // The event timings remain authoritative if the post-turn snapshot is
      // briefly behind the terminal SSE frame.
    }
    return {
      enqueueMs: Number((acceptedAt - sendStart).toFixed(2)),
      firstThinkingMs: firstThinkingAt === null
        ? null
        : Number((firstThinkingAt - sendStart).toFixed(2)),
      firstMs: firstAt === null ? null : Number((firstAt - sendStart).toFixed(2)),
      firstAfterAcceptanceMs: firstAt === null
        ? null
        : Number((firstAt - acceptedAt).toFixed(2)),
      fullMs: fullAt === null ? null : Number((fullAt - sendStart).toFixed(2)),
      firstContentDeliveryLagMs,
      fullDeliveryLagMs,
      terminalMs: terminalAt === null
        ? null
        : Number((terminalAt - sendStart).toFixed(2)),
      terminalDeliveryLagMs,
      eventCount,
      firstEventType,
      firstOccurredAtByType,
      lastOccurredAtByType,
      agentStartedMs: stageAt['agent.started'] === undefined
        ? null
        : Number(stageAt['agent.started'].toFixed(2)),
      messageStartedMs: stageAt['message.started'] === undefined
        ? null
        : Number(stageAt['message.started'].toFixed(2)),
      thinkingStartedMs: stageAt['thinking.started'] === undefined
        ? null
        : Number(stageAt['thinking.started'].toFixed(2)),
      accepted: response.accepted,
      routeMode: response.route?.mode,
      serverTiming,
    };
  };

  try {
    await sleep(prewarmWaitMs);
    const first = await measure(firstContent);
    if (oneTurnOnly) {
      console.log(JSON.stringify({ prewarmWaitMs, first }));
    } else {
      await sleep(1_200);
      const second = await measure(secondContent);
      console.log(JSON.stringify({ prewarmWaitMs, first, second }));
    }
  } finally {
    if (keepConversation) {
      console.error(JSON.stringify({ keptConversation: conversation.id }));
    } else {
      try {
        await cloud.deleteConversation(conversation.id);
      } catch {
        // Best-effort cleanup for the isolated latency conversation.
      }
    }
  }
};

void main();
