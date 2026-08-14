#!/usr/bin/env node
/**
 * Real iOS-link long-task test against daxueshenmai.top.
 * Mimics the exact HermesApiClient protocol: mobile token login -> create
 * conversation -> enqueue hosted turn -> consume the hosted-events SSE stream.
 * Measures: first-token latency, full-turn duration, tool/todo/reasoning
 * sequence, disconnects, and stall detection.
 *
 * Usage: node ios-longtask-test.mjs "<task prompt>" [maxSeconds]
 */
const BASE = 'https://daxueshenmai.top';
const USERNAME = process.env.HERMES_TEST_USER || '';
const PASSWORD = process.env.HERMES_TEST_PASSWORD || '';
const PROMPT = process.argv[2] || 'Run a bounded Hermes agent task and report every completed checkpoint.';
const MAX_SECONDS = Number(process.argv[3] || 3600);
if (!USERNAME || !PASSWORD) {
  throw new Error('Set HERMES_TEST_USER and HERMES_TEST_PASSWORD; test credentials are never embedded in source.');
}
if (!Number.isFinite(MAX_SECONDS) || MAX_SECONDS <= 0 || MAX_SECONDS > 24 * 60 * 60) {
  throw new Error('maxSeconds must be between 1 and 86400');
}

let accessToken = '';
let accountGeneration = '';

async function jsonRequest(path, { method = 'GET', body, token, signal, timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const requestSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: requestSignal,
    });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* non-json */ }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${text.slice(0, 300)}`);
  }
  return parsed;
}

async function login() {
  const body = await jsonRequest('/auth/mobile/token', {
    method: 'POST',
    body: { username: USERNAME, password: PASSWORD },
    timeoutMs: 60000,
  });
  accessToken = body.access_token || body.accessToken;
  if (!accessToken) throw new Error(`login response missing token: ${JSON.stringify(body).slice(0, 300)}`);
  accountGeneration = String(
    body.account_generation ?? body.accountGeneration ?? body.epoch ?? '',
  );
  console.log(`[login] ok account_generation=${accountGeneration || '(none)'}`);
}

async function createConversation() {
  const body = await jsonRequest('/api/plugins/collaboration/single/conversations', {
    method: 'POST',
    token: accessToken,
    body: { profile: 'default', title: '长任务测试' },
  });
  const conversation = body.conversation || body;
  const id = conversation.id || conversation.conversation_id;
  if (!id) throw new Error(`create conversation missing id: ${JSON.stringify(body).slice(0, 300)}`);
  console.log(`[conversation] id=${id}`);
  return id;
}

async function enqueue(conversationId, prompt) {
  const now = Date.now();
  const body = await jsonRequest(
    `/api/plugins/collaboration/single/conversations/${conversationId}/enqueue`,
    {
      method: 'POST',
      token: accessToken,
      body: {
        request_id: `e2e-${now}`,
        turn_id: `turn-${now}`,
        message: {
          content: prompt,
          created_at: now,
          id: `msg-${now}`,
          name: '你',
          role: 'user',
          status: 'completed',
        },
        profiles: ['default'],
        recent_messages: [],
      },
      timeoutMs: 60000,
    },
  );
  const turn = body.hosted_turn || {};
  if (turn.account_generation) accountGeneration = String(turn.account_generation);
  console.log(`[enqueue] accepted=${body.accepted} status=${turn.status} stage=${turn.stage} turn=${turn.turn_id || body.turn_id || body.turnId}`);
  return body;
}

function parseSseFrame(buffer) {
  const frames = [];
  let boundary;
  while ((boundary = /\r?\n\r?\n/.exec(buffer)) && boundary.index !== undefined) {
    const frameText = buffer.slice(0, boundary.index);
    buffer = buffer.slice(boundary.index + boundary[0].length);
    const lines = frameText.split(/\r?\n/);
    let eventType = 'message';
    const data = [];
    for (const line of lines) {
      if (!line || line.startsWith(':')) continue;
      const sep = line.indexOf(':');
      const field = sep >= 0 ? line.slice(0, sep) : line;
      const value = sep >= 0 ? line.slice(sep + 1).replace(/^ /, '') : '';
      if (field === 'event') eventType = value;
      else if (field === 'data') data.push(value);
    }
    if (data.length) {
      try { frames.push({ eventType, data: JSON.parse(data.join('\n')) }); }
      catch { frames.push({ eventType, data: data.join('\n') }); }
    }
  }
  return { frames, buffer };
}

async function consumeStream(conversationId, t0) {
  const controller = new AbortController();
  let cursor = 0;
  const url = `${BASE}/api/plugins/collaboration/single/conversations/${conversationId}/hosted-events`
    + `?cursor=${cursor}${accountGeneration ? `&expected_account_generation=${accountGeneration}` : ''}`;
  console.log(`[stream] ${url}`);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let firstTokenAt = 0;
  let firstEventAt = 0;
  let lastActivityAt = Date.now();
  let toolCount = 0;
  let todoCount = 0;
  let reasoningCount = 0;
  let deltaCount = 0;
  let completed = false;
  const observedEvents = [];
  const stallTimer = setInterval(() => {
    if (completed) return;
    const idle = Date.now() - lastActivityAt;
    if (idle > 300000) {
      console.log(`[stall] no event for ${(idle / 1000).toFixed(1)}s — aborting`);
      controller.abort();
    }
  }, 15000);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lastActivityAt = Date.now();
    buffer += decoder.decode(value, { stream: true });
    const { frames, buffer: rest } = parseSseFrame(buffer);
    buffer = rest;
    for (const frame of frames) {
      if (frame.eventType !== 'conversation' || !frame.data || typeof frame.data !== 'object') continue;
      const frameEvents = Array.isArray(frame.data.events) ? frame.data.events : [];
      if (Number.isFinite(Number(frame.data.cursor))) cursor = Math.max(cursor, Number(frame.data.cursor));
      if (!frameEvents.length) continue;
      for (const event of frameEvents) {
        const at = Date.now() - t0;
        const eventType = event.event_type || event.type || 'unknown';
        const roleStage = String(event.role_stage || '').split(':', 1)[0];
        // Match the iOS reducer's canonical surface. Worker/reviewer/reporter
        // events are real but are not the single-chat first-thinking metric.
        if (roleStage && roleStage !== 'chat' && roleStage !== 'turn') continue;
        if (!firstEventAt) firstEventAt = at;
        observedEvents.push(eventType);
        if (eventType === 'message.delta' || eventType === 'message.interim') {
          deltaCount += 1;
          if (!firstTokenAt) firstTokenAt = at;
        } else if (eventType === 'reasoning.delta' || eventType === 'reasoning.available' || eventType === 'thinking.delta') {
          reasoningCount += 1;
          if (!firstTokenAt) firstTokenAt = at;
        } else if (eventType.startsWith('tool.')) {
          toolCount += 1;
          const toolName = event.payload?.toolName || event.payload?.name || '';
          console.log(`  +${at / 1000}s [tool.${eventType.split('.')[1]}] ${toolName}`);
          if (eventType === 'tool.completed' || eventType === 'tool.complete') {
            const raw = event.payload?.result_text || event.payload?.result || event.payload?.todos;
            try {
              const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
              const todos = Array.isArray(parsed)
                ? parsed
                : parsed && Array.isArray(parsed.todos)
                  ? parsed.todos
                  : parsed && parsed.result && Array.isArray(parsed.result.todos)
                    ? parsed.result.todos
                    : null;
              if (todos) todoCount = todos.length;
            } catch { /* ordinary non-JSON tool output */ }
          }
        } else if (eventType === 'turn.completed' || eventType === 'turn.failed' || eventType === 'turn.cancelled') {
          completed = true;
          const total = Date.now() - t0;
          console.log(`\n=== TURN ${eventType} ===`);
          console.log(`first event:   ${(firstEventAt / 1000).toFixed(2)}s`);
          console.log(`first token:   ${(firstTokenAt / 1000).toFixed(2)}s`);
          console.log(`total:         ${(total / 1000).toFixed(2)}s`);
           console.log(`tool events:   ${toolCount}`);
           console.log(`todo count:    ${todoCount}`);
          console.log(`reasoning:     ${reasoningCount} deltas`);
          console.log(`message deltas:${deltaCount}`);
          console.log(`event types:   ${[...new Set(observedEvents)].slice(0, 20).join(', ')}`);
          clearInterval(stallTimer);
          return { firstEventAt, firstTokenAt, total, toolCount, todoCount, observedEvents, terminalStatus: eventType };
        } else if (eventType === 'message.completed') {
          const text = (event.payload?.text || event.payload?.content || '').slice(0, 200);
          console.log(`  +${at / 1000}s [message.completed] ${text.replace(/\n/g, ' ')}`);
        }
      }
    }
  }
  clearInterval(stallTimer);
  console.log('[stream] closed without terminal event');
  throw new Error('hosted event stream closed without a terminal event');
}

async function main() {
  console.log(`== iOS long-task test == prompt="${PROMPT.slice(0, 60)}..." max=${MAX_SECONDS}s`);
  const t0 = Date.now();
  await login();
  const conversationId = await createConversation();
  await enqueue(conversationId, PROMPT);
  const hardTimer = setTimeout(() => {
    console.log(`[hard-limit] ${MAX_SECONDS}s reached`);
    process.exit(3);
  }, MAX_SECONDS * 1000);
  const result = await consumeStream(conversationId, t0);
  clearTimeout(hardTimer);
  if (result.terminalStatus !== 'turn.completed') throw new Error(`turn ended with ${result.terminalStatus || 'no terminal status'}`);
  if (!result.firstTokenAt) throw new Error('terminal turn contained no accepted chat reasoning/message event');
  console.log(`== done == conversation=${conversationId} firstThinking=${result.firstTokenAt}ms`);
}

main().catch((error) => {
  console.error('[FAIL]', error.message);
  process.exit(1);
});
