import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import type { TextInput } from 'react-native';
import type {
  ConversationCollaborationState,
} from '../../api/chat-view-model';
import type { HostedTurnPendingAttachment } from '../../api/conversation-store-types';
import type { ChatComposerProps } from './ChatComposer';
import { serverFailure } from './chat-domain';
import { isLargePaste } from './composer-draft-policy';
import type { ChatAttachment, PendingPhase } from './chat-types';
import type { SlashCommandDescriptor } from './slash-command-model';
import type { HermesVoiceState } from './useHermesVoice';

export interface PreviewComposerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  appendLargePastedText(content: string): { attachment: ChatAttachment; marker: string } | null;
  attachments: readonly ChatAttachment[];
  autoFollowStreamRef: MutableRefObject<boolean>;
  canCancelHostedTurn: boolean;
  canSend: boolean;
  cancelActiveHostedTurn(): Promise<void>;
  cancellingHostedTurn: boolean;
  cleanupAttachmentSources(
    items: readonly ChatAttachment[] | readonly HostedTurnPendingAttachment[],
  ): void;
  collaborationState: ConversationCollaborationState;
  composerInputRef: RefObject<TextInput | null>;
  content: string;
  contentRef: MutableRefObject<string>;
  filteredSlashCommands: readonly SlashCommandDescriptor[];
  hostedRunning: boolean;
  inputFontSize: number;
  isChinese: boolean;
  keepLatestVisible(animated?: boolean, force?: boolean): void;
  keyboardAvoidanceEnabled: { value: number };
  notify(message: string): void;
  openAttachmentPicker(): void;
  pendingPhase: PendingPhase;
  pickPhoto(camera: boolean): Promise<void>;
  previewAttachment(attachment: ChatAttachment): Promise<void>;
  readRepliesAloud: boolean;
  reconnectAttempt: number;
  removeAttachment(attachment: ChatAttachment): void;
  requestSend(): void;
  selectSlashCommand(command: SlashCommandDescriptor): void;
  sending: boolean;
  setContent: Dispatch<SetStateAction<string>>;
  setSlashMenuOpen: Dispatch<SetStateAction<boolean>>;
  shareAttachment(attachment: ChatAttachment): Promise<void>;
  slashMenuOpen: boolean;
  updateAttachments(
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ): void;
  voiceDurationMs: number;
  voiceError: string;
  voicePreview: string;
  voiceState: HermesVoiceState;
  cancelVoiceInput(): void;
  startVoiceInput(): void;
  stopVoiceInput(): void;
  toggleReadRepliesAloud(): void;
}

/**
 * Build the composer props for the preview chat page.  Kept out of
 * PreviewChatPage.tsx so the page stays under its module-size ratchet
 * while the composer wiring remains in one place.
 */
export function buildPreviewComposerProps(
  options: PreviewComposerOptions,
): ChatComposerProps {
  const {
    activeConversationIdRef,
    appendLargePastedText,
    autoFollowStreamRef,
    cancelActiveHostedTurn,
    cleanupAttachmentSources,
    contentRef,
    isChinese,
    keepLatestVisible,
    keyboardAvoidanceEnabled,
    notify,
    openAttachmentPicker,
    pickPhoto,
    previewAttachment,
    removeAttachment,
    requestSend,
    selectSlashCommand,
    setContent,
    setSlashMenuOpen,
    shareAttachment,
    updateAttachments,
    cancelVoiceInput,
    startVoiceInput,
    stopVoiceInput,
    toggleReadRepliesAloud,
  } = options;

  return {
    actions: {
      onCancelHostedTurn: () => { void cancelActiveHostedTurn(); },
      onContentChange: (next) => {
        const previous = contentRef.current;
        if (isLargePaste(previous, next)) {
          const conversationId = activeConversationIdRef.current;
          try {
            const prepared = appendLargePastedText(next);
            if (!prepared) return;
            if (
              contentRef.current !== previous
              || activeConversationIdRef.current !== conversationId
            ) {
              cleanupAttachmentSources([prepared.attachment]);
              return;
            }
            updateAttachments((current) => [...current, prepared.attachment]);
            contentRef.current = prepared.marker;
            setContent(prepared.marker);
            setSlashMenuOpen(false);
          } catch (error) {
            notify(serverFailure(error, isChinese));
          }
          return;
        }
        contentRef.current = next;
        setContent(next);
        setSlashMenuOpen(next.trimStart().startsWith('/'));
      },
      onFocus: () => {
        keyboardAvoidanceEnabled.value = 1;
        autoFollowStreamRef.current = true;
        keepLatestVisible(false, true);
      },
      onOpenAttachmentPicker: openAttachmentPicker,
      onPreviewAttachment: (attachment) => { void previewAttachment(attachment); },
      onRemoveAttachment: removeAttachment,
      onSelectSlashCommand: selectSlashCommand,
      onSend: requestSend,
      onShareAttachment: (attachment) => { void shareAttachment(attachment); },
      onTakePhoto: () => { void pickPhoto(true); },
      onCancelVoiceInput: () => { void cancelVoiceInput(); },
      onStartVoiceInput: () => { void startVoiceInput(); },
      onStopVoiceInput: () => { void stopVoiceInput(); },
      onToggleReadRepliesAloud: toggleReadRepliesAloud,
    },
    inputRef: options.composerInputRef,
    model: {
      attachments: options.attachments,
      canCancelHostedTurn: options.canCancelHostedTurn,
      canSend: options.canSend,
      cancellingHostedTurn: options.cancellingHostedTurn,
      collaborationState: options.collaborationState,
      content: options.content,
      filteredSlashCommands: options.filteredSlashCommands,
      hostedRunning: options.hostedRunning,
      inputFontSize: options.inputFontSize,
      isChinese: options.isChinese,
      pendingPhase: options.pendingPhase,
      readRepliesAloud: options.readRepliesAloud,
      reconnectAttempt: options.reconnectAttempt,
      sending: options.sending,
      slashMenuOpen: options.slashMenuOpen,
      voiceDurationMs: options.voiceDurationMs,
      voiceError: options.voiceError,
      voicePreview: options.voicePreview,
      voiceState: options.voiceState,
    },
  };
}
