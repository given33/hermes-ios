import assert from 'node:assert/strict';
import test from 'node:test';
import { configuredChatModels } from '../src/studio/chat/chat-model-options';

test('only configured models are selectable, preserving provider identity and the active model', () => {
  const choices = configuredChatModels({ provider: 'custom:a', model: 'current', providers: [
    { slug: 'custom:a', authenticated: true, models: ['fast', { id: 'large' }, 'fast'] },
    { slug: 'custom:b', authenticated: true, models: ['fast', 'unavailable'], unavailable_models: ['unavailable'] },
    { slug: 'empty', authenticated: false, models: ['needs-key'] },
    { slug: 'moa', authenticated: true, models: ['default'] },
  ] });
  assert.deepEqual(choices.map(({ provider, model }) => [provider, model]), [
    ['custom:a', 'fast'], ['custom:a', 'large'], ['custom:b', 'fast'], ['custom:a', 'current'],
  ]);
});
