export interface ComposerVoiceControlState {
  readRepliesAloud: boolean;
  sending: boolean;
  voiceState: string;
}

export type ComposerVoicePrimaryAction = 'toggleReadRepliesAloud' | 'toggleVoiceInput' | 'none';

export function canActivateComposerVoiceInput(
  state: Pick<ComposerVoiceControlState, 'sending' | 'voiceState'>,
): boolean {
  return !state.sending || state.voiceState === 'listening';
}

export function isComposerVoiceControlDisabled(state: ComposerVoiceControlState): boolean {
  return !canActivateComposerVoiceInput(state) && !state.readRepliesAloud;
}

export function composerVoicePrimaryAction(
  state: ComposerVoiceControlState,
): ComposerVoicePrimaryAction {
  if (canActivateComposerVoiceInput(state)) return 'toggleVoiceInput';
  if (state.readRepliesAloud) return 'toggleReadRepliesAloud';
  return 'none';
}
