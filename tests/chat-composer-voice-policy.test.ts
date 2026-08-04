import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canActivateComposerVoiceInput,
  composerVoicePrimaryAction,
  formatVoiceDuration,
  isComposerVoiceControlDisabled,
} from '../src/studio/chat/chat-composer-voice-policy';

test('voice conversation remains interruptible while a reply is generating', () => {
  const state = {
    readRepliesAloud: true,
    sending: true,
    voiceState: 'idle',
  };

  assert.equal(isComposerVoiceControlDisabled(state), false);
  assert.equal(canActivateComposerVoiceInput(state), true);
  assert.equal(composerVoicePrimaryAction(state), 'startVoiceInput');
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
  assert.equal(composerVoicePrimaryAction(state), 'stopVoiceInput');
});

test('transcription keeps the microphone disabled until the transcript arrives', () => {
  const state = {
    readRepliesAloud: false,
    sending: false,
    voiceState: 'transcribing',
  };

  assert.equal(canActivateComposerVoiceInput(state), false);
  assert.equal(isComposerVoiceControlDisabled(state), true);
  assert.equal(composerVoicePrimaryAction(state), 'none');
});

test('an idle composer starts voice input and formats its recording clock', () => {
  assert.equal(composerVoicePrimaryAction({
    readRepliesAloud: false,
    sending: false,
    voiceState: 'idle',
  }), 'startVoiceInput');
  assert.equal(formatVoiceDuration(0), '0:00');
  assert.equal(formatVoiceDuration(65_900), '1:05');
});

test('streaming speech can be interrupted directly into a new voice turn', () => {
  const state = {
    readRepliesAloud: true,
    sending: true,
    voiceState: 'speaking',
  };

  assert.equal(canActivateComposerVoiceInput(state), true);
  assert.equal(isComposerVoiceControlDisabled(state), false);
  assert.equal(composerVoicePrimaryAction(state), 'startVoiceInput');
});
