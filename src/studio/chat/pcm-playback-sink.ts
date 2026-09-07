import { hasNativeIOSContext, HermesIOSContext } from '../../../modules/hermes-ios-context';
import type { PCMPlaybackSink } from './server-speech-session';

export function createPCMPlaybackSink(_onDrained: () => void): PCMPlaybackSink | null {
  if (!hasNativeIOSContext) return null;
  return {
    append: (data) => HermesIOSContext.appendPCMPlayback(data),
    finish: () => HermesIOSContext.finishPCMPlayback(),
    start: (rate, channels) => HermesIOSContext.startPCMPlayback(rate, channels),
    stop: (interrupted) => HermesIOSContext.stopPCMPlayback(interrupted),
  };
}
