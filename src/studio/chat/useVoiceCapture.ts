import { RecordingPresets, useAudioRecorder, useAudioRecorderState } from 'expo-audio';

export function useVoiceCapture() {
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  return { recorder, state: { ...state, level: typeof state.metering === 'number'
    ? Math.min(1, Math.pow(10, state.metering / 20) * 128 / 42) : 0 } };
}
