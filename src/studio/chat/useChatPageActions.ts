import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from 'react';
import { useCallback } from 'react';
import type { TextInput } from 'react-native';

import type { HermesCloudApi } from '../../api/HermesCloudApi';
import type {
  ConversationCollaborationState,
  HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { serverFailure } from './chat-domain';
import type { ChatAttachment } from './chat-types';
import { isRemoteConsoleCommand, isStopSlashCommand } from './mobile-console-model';

export function useMentionMemberAction({
  composerInputRef,
  contentRef,
  setContent,
}: {
  composerInputRef: RefObject<TextInput | null>;
  contentRef: MutableRefObject<string>;
  setContent: Dispatch<SetStateAction<string>>;
}) {
  return useCallback((message: ChatMessage) => {
    if (message.role === 'user') return;
    const mention = `@${message.name.trim()} `;
    const current = contentRef.current;
    const next = current.trim()
      ? `${current.replace(/\s*$/, '')} ${mention}`
      : mention;
    contentRef.current = next;
    setContent(next);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }, [composerInputRef, contentRef, setContent]);
}

export function useCollaborationStateUpdater({
  activeConversationIdRef,
  collaborationStateByConversationRef,
  setCollaborationState,
}: {
  activeConversationIdRef: MutableRefObject<string>;
  collaborationStateByConversationRef: MutableRefObject<Map<string, ConversationCollaborationState>>;
  setCollaborationState: Dispatch<SetStateAction<ConversationCollaborationState>>;
}) {
  return useCallback((
    conversationId: string,
    nextState: ConversationCollaborationState,
  ) => {
    if (!conversationId) return;
    const current = collaborationStateByConversationRef.current.get(conversationId) || 'single';
    const resolved = current === 'active' || nextState === 'active'
      ? 'active'
      : current === 'lifting' && nextState === 'single'
        ? 'lifting'
        : nextState;
    collaborationStateByConversationRef.current.set(conversationId, resolved);
    if (activeConversationIdRef.current === conversationId) {
      setCollaborationState(resolved);
    }
  }, [activeConversationIdRef, collaborationStateByConversationRef, setCollaborationState]);
}

export function useRelayCheckAction({
  cloudApi,
  isChinese,
  notify,
}: {
  cloudApi: HermesCloudApi | null;
  isChinese: boolean;
  notify(message: string): void;
}) {
  return useCallback(() => {
    if (!cloudApi) {
      notify(isChinese ? 'API Relay 仅在连接 Hermes 后可用' : 'API Relay requires a Hermes connection');
      return;
    }
    void cloudApi.getStatus()
      .then(() => notify(isChinese ? 'API Relay 连接正常' : 'API Relay is connected'))
      .catch((error) => notify(serverFailure(error, isChinese)));
  }, [cloudApi, isChinese, notify]);
}

export function useChatSendAction({
  attachmentsRef,
  canCancelHostedTurn,
  cancelActiveHostedTurn,
  contentRef,
  executeConsoleCommand,
  hostedRequestSend,
  isChinese,
  notify,
  setContent,
  setSlashMenuOpen,
}: {
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  canCancelHostedTurn: boolean;
  cancelActiveHostedTurn(): Promise<void>;
  contentRef: MutableRefObject<string>;
  executeConsoleCommand(draft: string): Promise<boolean>;
  hostedRequestSend(): void;
  isChinese: boolean;
  notify(message: string): void;
  setContent: Dispatch<SetStateAction<string>>;
  setSlashMenuOpen(open: boolean): void;
}) {
  return useCallback(() => {
    const draft = contentRef.current.trim();
    if (isStopSlashCommand(draft)) {
      contentRef.current = '';
      setContent('');
      setSlashMenuOpen(false);
      if (canCancelHostedTurn) {
        void cancelActiveHostedTurn();
      } else {
        notify(isChinese ? '当前没有正在运行的任务。' : 'No task is currently running.');
      }
      return;
    }
    if (isRemoteConsoleCommand(draft)) {
      if (attachmentsRef.current.length > 0) {
        notify(isChinese
          ? '命令行操作不接受附件，请先移除附件。'
          : 'Console commands do not accept attachments. Remove them first.');
        return;
      }
      void executeConsoleCommand(draft);
      return;
    }
    hostedRequestSend();
  }, [
    attachmentsRef,
    canCancelHostedTurn,
    cancelActiveHostedTurn,
    contentRef,
    executeConsoleCommand,
    hostedRequestSend,
    isChinese,
    notify,
    setContent,
    setSlashMenuOpen,
  ]);
}
