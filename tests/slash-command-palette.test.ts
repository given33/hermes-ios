import assert from 'node:assert/strict';
import test from 'node:test';

import {
  selectSlashCommandDescriptor,
  shouldAutoOpenSlashMenu,
  slashCommandMatchScore,
  type SlashCommandDescriptor,
} from '../src/studio/chat/slash-command-model';

function command(overrides: Partial<SlashCommandDescriptor> = {}): SlashCommandDescriptor {
  return {
    command: '/sessions list',
    usage: 'sessions list',
    category: 'sessions',
    requiresArgument: false,
    requiresConfirmation: false,
    en: 'List sessions',
    zh: '列出会话',
    ...overrides,
  };
}

test('slash command palette matches non-contiguous command characters', () => {
  const score = slashCommandMatchScore('ssls', command());
  assert.equal(Number.isFinite(score), true);
});

test('slash command palette ranks exact command matches ahead of fuzzy descriptions', () => {
  const exact = slashCommandMatchScore('status', command({ command: '/status', usage: 'status' }));
  const fuzzy = slashCommandMatchScore('status', command({
    command: '/system health',
    usage: 'system health',
    en: 'Show status information',
  }));
  assert.equal(exact < fuzzy, true);
});

test('slash command palette rejects unrelated text', () => {
  assert.equal(slashCommandMatchScore('zzzz', command()), Number.POSITIVE_INFINITY);
});

test('commands that still need an argument keep the palette open', () => {
  assert.deepEqual(
    selectSlashCommandDescriptor(command({
      command: '/config set',
      requiresArgument: true,
    })),
    { content: '/config set ', keepMenuOpen: true },
  );
  assert.deepEqual(
    selectSlashCommandDescriptor(command({ command: '/status' })),
    { content: '/status ', keepMenuOpen: false },
  );
  assert.deepEqual(
    selectSlashCommandDescriptor(command({
      command: 'model.provider',
      selectionContent: '/config set model.provider ',
      keepMenuOpen: true,
    })),
    { content: '/config set model.provider ', keepMenuOpen: true },
  );
});

test('slash drafts reopen the palette unless a completed selection suppressed it', () => {
  assert.equal(shouldAutoOpenSlashMenu('/status', ''), true);
  assert.equal(shouldAutoOpenSlashMenu('  /status', ''), true);
  assert.equal(shouldAutoOpenSlashMenu('/status ', '/status '), false);
  assert.equal(shouldAutoOpenSlashMenu('ordinary message', ''), false);
});
