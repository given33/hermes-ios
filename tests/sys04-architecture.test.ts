import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isHermesSwiftUIRouteActionPayload } from '../src/app/swiftui-route-actions.generated';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const lines = (path: string) => read(path).split(/\r?\n/).length;

test('chat dependency layers and module-size ratchets stay enforced', () => {
  const lowerLayerPaths = [
    ...readdirSync(resolve(root, 'src/api/cloud'))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `src/api/cloud/${name}`),
    'src/api/conversation-cache-repository.ts',
    'src/api/conversation-draft-repository.ts',
    'src/api/conversation-local-store.ts',
    'src/studio/chat/chat-domain.ts',
    'src/studio/chat/composer-draft-policy.ts',
    'src/studio/chat/hosted-send-draft-state.ts',
    'src/studio/chat/hosted-turn-delivery-service.ts',
  ];
  for (const path of lowerLayerPaths) {
    const source = read(path);
    assert.doesNotMatch(source, /from ['"]react(?:-native)?['"]/, path);
    assert.doesNotMatch(source, /Presentation(?:\.tsx)?['"]/, path);
  }

  for (const [path, limit] of [
    ['src/studio/PreviewChatPage.tsx', 900],
    ['src/api/HermesCloudApi.ts', 1_100],
    ['src/api/conversation-local-store.ts', 551], // +1: resetCachedConversationTranscript re-export
    ['src/studio/chat/useChatPageState.ts', 160],
  ] as const) {
    assert.ok(lines(path) <= limit, `${path} exceeded ${limit} lines`);
  }
});

test('the versioned schema generates TypeScript, Swift, and Python contracts', () => {
  const spec = JSON.parse(read('docs/spec/swiftui-route-actions.json')) as {
    version: number;
    actions: Record<string, string>;
  };
  const typeScript = read('src/app/swiftui-route-actions.generated.ts');
  const swift = read(
    'modules/hermes-ios-controls/ios/HermesSwiftUIRouteActions.generated.swift',
  );
  const python = read('contracts/python/hermes_swiftui_route_actions.py');

  assert.match(typeScript, new RegExp(`SNAPSHOT_VERSION = ${spec.version}`));
  assert.match(swift, new RegExp(`hermesRouteSnapshotVersion = ${spec.version}`));
  assert.match(python, new RegExp(`SCHEMA_VERSION: Final = ${spec.version}`));
  for (const action of Object.values(spec.actions)) {
    assert.ok(typeScript.includes(`'${action}'`), action);
    assert.ok(swift.includes(`"${action}"`), action);
    assert.ok(python.includes(`"${action}"`), action);
  }
});

test('route action validation keeps a bounded module-level cost', () => {
  const started = performance.now();
  for (let index = 0; index < 100_000; index += 1) {
    assert.equal(isHermesSwiftUIRouteActionPayload({ route: 'chat' }), true);
  }
  assert.ok(performance.now() - started < 2_000);
});
