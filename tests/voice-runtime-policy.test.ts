import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeClientVoiceConfig } from '../src/api/cloud/audio';
import {
  resolveVoiceRuntime,
  shouldLoadElevenLabsVoices,
} from '../src/studio/chat/voice-runtime-policy';

test('voice config is reduced to non-secret fields at the API boundary', () => {
  const config = sanitizeClientVoiceConfig({
    ok: true,
    stt: {
      api_key: 'stt-secret',
      base_url: 'https://credential-host.invalid',
      mode: 'direct',
      provider: 'openai',
      wire: 'openai-multipart',
    },
    tts: {
      api_key: 'tts-secret',
      base_url: 'https://credential-host.invalid',
      mode: 'direct',
      model: 'eleven_flash_v2_5',
      provider: 'elevenlabs',
      voice: 'voice-123',
      wire: 'elevenlabs-tts',
    },
  });

  assert.deepEqual(config, {
    ok: true,
    stt: { mode: 'direct', provider: 'openai' },
    tts: {
      mode: 'direct',
      model: 'eleven_flash_v2_5',
      provider: 'elevenlabs',
      voice: 'voice-123',
    },
  });
  const serialized = JSON.stringify(config);
  assert.doesNotMatch(serialized, /secret|base_url|api_key|wire|credential-host/);
});

test('only explicit client/native modes select Apple voice services', () => {
  assert.deepEqual(resolveVoiceRuntime({
    ok: true,
    stt: { mode: 'client' },
    tts: { mode: 'native' },
  }), {
    loaded: true,
    selectedVoiceId: '',
    sttMode: 'native',
    ttsMode: 'native',
    ttsProvider: '',
  });

  const server = resolveVoiceRuntime({
    ok: true,
    stt: { mode: 'direct', provider: 'openai' },
    tts: { mode: 'relay', provider: 'elevenlabs', voice: 'voice-123' },
  });
  assert.equal(server.sttMode, 'server');
  assert.equal(server.ttsMode, 'server');
  assert.equal(server.selectedVoiceId, 'voice-123');
  assert.equal(shouldLoadElevenLabsVoices(server), true);
});

test('failed or malformed config never silently enables native voice', () => {
  const runtime = resolveVoiceRuntime({
    ok: false,
    stt: { mode: 'native' },
    tts: { mode: 'native' },
  });
  assert.equal(runtime.loaded, true);
  assert.equal(runtime.sttMode, 'unavailable');
  assert.equal(runtime.ttsMode, 'unavailable');
});
