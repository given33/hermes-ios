import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('compact chat keeps messages, todo cards, and the plan inside horizontal safe areas', () => {
  const shell = read('src/studio/chat/ChatPageShell.tsx');
  const stream = read('src/studio/chat/ChatMessageStream.tsx');
  const plan = read('src/studio/chat/ChatPlanDrawer.tsx');

  assert.match(shell, /<ChatMessageStream[\s\S]*safeAreaLeft=\{safeAreaLeft\}[\s\S]*safeAreaRight=\{safeAreaRight\}/);
  assert.match(stream, /paddingLeft: \(compact \? 12 : 20\) \+ safeAreaLeft/);
  assert.match(stream, /paddingRight: \(compact \? 12 : 20\) \+ safeAreaRight/);
  assert.match(shell, /<ChatPlanDrawer[\s\S]*safeAreaLeft=\{safeAreaLeft\}[\s\S]*safeAreaRight=\{safeAreaRight\}/);
  assert.match(plan, /marginLeft: safeAreaLeft, marginRight: safeAreaRight/);
  assert.match(plan, /nestedScrollEnabled/);
  assert.match(plan, /maxHeight: 172/);
});

test('compact context and todo surfaces use bounded, non-overlapping geometry', () => {
  const shell = read('src/studio/chat/ChatPageShell.tsx');
  const styles = read('src/studio/chat/chat-presentation-styles.ts');
  const todo = read('src/studio/chat/TodoSection.tsx');

  assert.match(shell, /styles\.contextUsageRow[\s\S]*paddingRight: \(compact \? 4 : 8\) \+ safeAreaRight/);
  assert.match(styles, /contextUsageRow: \{[^\n]*justifyContent: 'flex-end'[^\n]*minHeight: 32/);
  assert.match(styles, /contextRing: \{[^\n]*height: 28[^\n]*minWidth: 72/);
  assert.doesNotMatch(styles, /contextRing: \{[^\n]*width: 26/);
  assert.match(styles, /todoSection: \{[^\n]*maxWidth: 520[^\n]*width: '100%'/);
  assert.match(styles, /todoTitle: \{[^\n]*flex: 1/);
  assert.match(todo, /numberOfLines=\{2\}/);
});
