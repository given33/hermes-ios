import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { mergeUnifiedConversationIndex } from '../src/api/conversation-index.ts';
import { conversationHistoryCategory } from '../src/api/conversation-history-presentation.ts';

const input = createInterface({ input: process.stdin, terminal: false });
const credentials = JSON.parse(await input.question(''));
input.close();
const { request } = await import(pathToFileURL(process.argv[2]).href);
const context = await request.newContext({ baseURL: 'http://localhost:8082/', timeout: 120000 });
const output = process.argv[3];
await mkdir(output, { recursive: true });
const protectedIds = new Set(['chat_ae8eff3e341f', 'chat_user-mtr1hikn-1c62a794-5c9c-430b-b103-fa3428407add']);
const knownAcceptanceIds = new Set([
  'chat_user-mtr2k3cr-52cb6309-4c6d-43e8-81f2-dd9b5835080f',
  'chat_user-mtr1hikn-1c62a794-5c9c-430b-b103-fa3428407add',
  'chat_user-mtqycuc4-fb0d9d4d-9157-478c-8b3a-4db13d31223d',
  'chat_user-mtqwuldd-af799bdc-9b9b-4437-b7fa-9e26a7413c80',
  'chat_user-mtqke82x-4fa108c1-5c62-4bcb-b90a-d80998a038cd',
]);
const proof = /E2E|验收|测试|探针|probe|latency audit|concurrent latency|login latency|hermes-recon|recon-final|hello-new-arch|delivery_done|phase_one|file_delivery_verified|curl-timing|SSE首字|SSE速率|第\d+轮|基准|速度验证|速度精确|^(?:reply\s+|请只回复(?:两个字|一个词)[：:]?\s*)?p(?:ing|ong)$/i;
const original = JSON.parse(await readFile(path.join(os.tmpdir(), 'hermes-history-20260907/index.json'), 'utf8'));
const originalTitles = new Map(original.conversations.map(item => [item.id, item.title]));
for (const folder of await readdir(os.tmpdir(), { withFileTypes: true })) {
  if (!folder.isDirectory() || !folder.name.startsWith('hermes-delivery-20260907-')) continue;
  try {
    const records = JSON.parse(await readFile(path.join(os.tmpdir(), folder.name, 'delivery.json'), 'utf8'));
    for (const record of records) {
      if (record.kind !== 'http' || !record.path?.endsWith('/enqueue')) continue;
      const id = record.path.match(/\/conversations\/([^/]+)\/enqueue$/)?.[1];
      if (id) knownAcceptanceIds.add(id);
    }
  } catch { /* In-progress runs do not yet have an evidence file. */ }
}
try {
  const auth = await context.post('/auth/mobile/token', { data: credentials });
  if (!auth.ok()) throw new Error(`Login failed: ${auth.status()}`);
  const { access_token } = await auth.json();
  const headers = { Authorization: `Bearer ${access_token}` };
  const get = async path => {
    const response = await context.get(path, { headers });
    if (!response.ok()) throw new Error(`${path}: ${response.status()}`);
    return response.json();
  };
  const { conversations } = await get('/api/plugins/collaboration/single/conversations');
  const report = { before: conversations.length, changes: [], conversations: [] };
  const activeChats = conversations.filter(item => protectedIds.has(item.id) && item.history_category === 'test');
  if (activeChats.length) {
    const response = await context.post('/api/plugins/collaboration/single/conversations/organize',
      { headers, data: { conversation_ids: activeChats.map(item => item.id), history_category: 'chat' } });
    if (!response.ok()) throw new Error(`Restore active chat category failed: ${response.status()}`);
  }
  for (const conversation of conversations) {
    if (protectedIds.has(conversation.id)) continue;
    let reason = knownAcceptanceIds.has(conversation.id) ? 'Known acceptance conversation' : '';
    if (!reason && proof.test(conversation.title)) reason = 'Explicit test title';
    if (!reason && proof.test(originalTitles.get(conversation.id) || '')) reason = 'Original explicit test title';
    if (!reason && /\b(?:delivery_done|file_delivery_verified|search_done)\b/.test(conversation.preview || '')) reason = 'Recorded acceptance result marker';
    if (!reason || conversation.history_category === 'test') continue;
    report.changes.push({ id: conversation.id, previous: conversation.history_category || 'chat', category: 'test', reason });
    console.log(JSON.stringify({ classified: conversation.id, reason }));
  }
  if (report.changes.length) {
    const response = await context.post('/api/plugins/collaboration/single/conversations/organize',
      { headers, data: { conversation_ids: report.changes.map(item => item.id), history_category: 'test' } });
    if (!response.ok()) throw new Error(`Classification failed: ${response.status()}`);
  }
  const updated = (await get('/api/plugins/collaboration/single/conversations')).conversations;
  const { sessions } = await get('/api/profiles/sessions?profile=all&limit=500&offset=0&order=recent&archived=exclude&min_messages=0');
  const merged = mergeUnifiedConversationIndex(updated, sessions);
  report.conversations = merged.map(item => ({ id: item.id, title: item.title, category: conversationHistoryCategory(item),
    created_at: item.created_at, message_count: item.message_count, runtime_sessions: item.runtime_sessions }));
  report.counts = report.conversations.reduce((counts, item) => ({ ...counts, [item.category]: (counts[item.category] || 0) + 1 }), {});
  report.rawRuntimeSessions = sessions.length;
  report.canonicalRows = merged.length;
  await writeFile(`${output}/history-organization.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ before: report.before, rawRuntimeSessions: sessions.length, canonicalRows: merged.length, counts: report.counts, changes: report.changes.length }));
} finally { await context.dispose(); }
