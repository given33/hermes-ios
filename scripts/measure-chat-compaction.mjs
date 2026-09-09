import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { compactChatMessages } from '../src/studio/chat/chat-member-model.ts';

const previousSource = execFileSync('git', ['show', 'HEAD:src/studio/chat/chat-member-model.ts'], { encoding: 'utf8' });
const compiled = ts.transpileModule(previousSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const previousExports = {};
new Function('exports', compiled)(previousExports);
const results = [];
for (const turns of [100, 1000, 5000]) {
  const messages = Array.from({ length: turns }, (_, index) => [
    { id: `user-${index}`, role: 'user', name: 'User', runtimeTurnId: `turn-${index}`, content: 'Inspect task' },
    { id: `reply-${index}`, role: 'assistant', name: 'Hermes', runtimeTurnId: `turn-${index}`, content: 'Result' },
  ]).flat();
  assert.deepEqual(compactChatMessages(messages), previousExports.compactChatMessages(messages));
  function measure(fn) {
    fn(messages);
    const samples = [];
    for (let iteration = 0; iteration < 15; iteration++) {
      const start = performance.now();
      fn(messages);
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { medianMs: Number(samples[7].toFixed(3)), p95Ms: Number(samples[14].toFixed(3)) };
  }
  const row = { turns, before: measure(previousExports.compactChatMessages), after: measure(compactChatMessages) };
  results.push(row);
  console.log(JSON.stringify(row));
}
await mkdir('.expo/timeline-verification', { recursive: true });
await writeFile('.expo/timeline-verification/compaction.json', JSON.stringify(results, null, 2));
