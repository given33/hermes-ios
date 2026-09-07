import type { PCMPlaybackSink } from './server-speech-session';

export function createPCMPlaybackSink(onDrained: () => void): PCMPlaybackSink | null {
  const Constructor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!Constructor) return null;
  let context: AudioContext | null = null;
  let channels = 1;
  let sampleRate = 24_000;
  let scheduledUntil = 0;
  let generation = 0;
  const sources = new Set<AudioBufferSourceNode>();
  let resolveDrain: (() => void) | null = null;
  return {
    async start(rate, count) {
      context = new Constructor();
      await context.resume();
      sampleRate = rate;
      channels = count;
      scheduledUntil = context.currentTime;
      return context.state === 'running';
    },
    async append(base64PCM) {
      if (!context || context.state !== 'running') return false;
      const binary = atob(base64PCM);
      if (binary.length % (2 * channels)) throw new Error('Invalid PCM frame length');
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const samples = new DataView(bytes.buffer);
      const frames = bytes.length / (2 * channels);
      if (!frames) return true;
      const buffer = context.createBuffer(channels, frames, sampleRate);
      for (let channel = 0; channel < channels; channel += 1) {
        const data = buffer.getChannelData(channel);
        for (let frame = 0; frame < frames; frame += 1) data[frame] = samples.getInt16((frame * channels + channel) * 2, true) / 32768;
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      sources.add(source);
      source.onended = () => { sources.delete(source); source.disconnect(); if (!sources.size) resolveDrain?.(); };
      const startAt = Math.max(context.currentTime + 0.015, scheduledUntil);
      source.start(startAt);
      scheduledUntil = startAt + buffer.duration;
      return true;
    },
    async finish() {
      const version = generation;
      if (sources.size) await new Promise<void>((resolve) => { resolveDrain = resolve; });
      resolveDrain = null;
      if (version !== generation) return false;
      await context?.close();
      context = null;
      onDrained();
      return true;
    },
    async stop() {
      generation += 1;
      for (const source of sources) { try { source.stop(); } catch { /* Already ended. */ } }
      sources.clear();
      resolveDrain?.();
      resolveDrain = null;
      await context?.close();
      context = null;
      return true;
    },
  };
}
