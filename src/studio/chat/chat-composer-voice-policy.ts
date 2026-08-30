export interface ComposerVoiceControlState {
  readRepliesAloud: boolean;
  sending: boolean;
  voiceAvailable?: boolean;
  voiceState: string;
}

export type ComposerVoicePrimaryAction =
  | 'toggleReadRepliesAloud'
  | 'startVoiceInput'
  | 'stopVoiceInput'
  | 'none';

export function canActivateComposerVoiceInput(
  state: ComposerVoiceControlState,
): boolean {
  if (state.voiceAvailable === false
    && state.voiceState !== 'listening'
    && state.voiceState !== 'speaking') return false;
  if (state.voiceState === 'transcribing') return false;
  return !state.sending
    || state.readRepliesAloud
    || state.voiceState === 'listening'
    || state.voiceState === 'speaking';
}

export function isComposerVoiceControlDisabled(state: ComposerVoiceControlState): boolean {
  return !canActivateComposerVoiceInput(state) && !state.readRepliesAloud;
}

export function composerVoicePrimaryAction(
  state: ComposerVoiceControlState,
): ComposerVoicePrimaryAction {
  if (state.voiceState === 'listening') return 'stopVoiceInput';
  if (canActivateComposerVoiceInput(state)) return 'startVoiceInput';
  if (state.readRepliesAloud) return 'toggleReadRepliesAloud';
  return 'none';
}

export function formatVoiceDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
