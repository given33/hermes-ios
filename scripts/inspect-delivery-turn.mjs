import { createInterface } from 'node:readline/promises';

const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const base = 'http://localhost:8082';
const response = await fetch(`${base}/auth/mobile/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials),
});
if (!response.ok) throw new Error(`Login HTTP ${response.status}`);
const auth = await response.json();
const token = auth.access_token || auth.tokens?.access_token;
const id = process.argv[2], turnId = process.argv[3];
const result = await fetch(`${base}/api/plugins/collaboration/single/conversations/${encodeURIComponent(id)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
if (!result.ok) throw new Error(`Conversation HTTP ${result.status}`);
const { conversation } = await result.json();
const run = conversation.hosted_turns?.[turnId];
const fields = value => Object.fromEntries(Object.entries(value || {}).filter(([key]) =>
  /^(status|stage|profile|member_id|message_key|final_report|runtime_turn_id|role_stage|phase|result|content|.*_at|remote_phase|server_fallback)$/.test(key)));
console.log(JSON.stringify({ run: fields(run), roles: Object.fromEntries(Object.entries(run?.role_events || {}).map(([key, value]) => [key, fields(value)])),
  messages: conversation.messages.filter(message => message.meta?.runtime_turn_id === turnId).map(message => ({
    id: message.id, name: message.name, ...fields(message), meta: fields(message.meta),
  })),
  events: (conversation.hosted_events || []).filter(event => event.turn_id === turnId && /completed|handoff/.test(event.event_type)).map(event => ({
    type: event.event_type, stage: event.role_stage, cursor: event.cursor, payload: fields(event.payload),
  })),
}, null, 2));
