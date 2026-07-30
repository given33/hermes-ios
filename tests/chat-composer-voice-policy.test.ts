import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canActivateComposerVoiceInput,
  composerVoicePrimaryAction,
  isComposerVoiceControlDisabled,
} from '../src/studio/chat/chat-composer-voice-policy';

test('sending keeps the voice control available only to turn off spoken replies', () => {
  const state = {
    readRepliesAloud: true,
    sending: true,
    voiceState: 'idle',
  };

  assert.equal(isComposerVoiceControlDisabled(state), false);
  assert.equal(canActivateComposerVoiceInput(state), false);
  assert.equal(composerVoicePrimaryAction(state), 'toggleReadRepliesAloud');
});

test('sending disables an idle voice control when spoken replies are already off', () => {
  const state = {
    readRepliesAloud: false,
    sending: true,
    voiceState: 'idle',
  };

  assert.equal(isComposerVoiceControlDisabled(state), true);
  assert.equal(canActivateComposerVoiceInput(state), false);
  assert.equal(composerVoicePrimaryAction(state), 'none');
});

test('an active voice session can still be stopped while sending', () => {
  const state = {
    readRepliesAloud: false,
    sending: true,
    voiceState: 'listening',
  };

  assert.equal(isComposerVoiceControlDisabled(state), false);
  assert.equal(canActivateComposerVoiceInput(state), true);
  assert.equal(composerVoicePrimaryAction(state), 'toggleVoiceInput');
});
