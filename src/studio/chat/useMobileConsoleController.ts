import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import type { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import {
  collaborationMessageToView,
  upsertChatMessage,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { serverFailure, uniqueTurnId } from './chat-domain';
import {
  consoleInvocationBlocksActiveView,
  consoleInvocationOwnsActiveView,
  isRemoteConsoleCommand,
  mobileConsoleResultText,
} from './mobile-console-model';

interface MobileConsoleControllerOptions {
  activeConversationId: string;
  activeConversationIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation, expectedOwnerEpoch?: number): void;
  cacheOwner: string;
  cloudApi: HermesCloudApi | null;
  conversationSyncGenerationRef: MutableRefObject<ConversationSyncGeneration>;
  contentRef: MutableRefObject<string>;
  isChinese: boolean;
  notify(message: string): void;
  profile: string;
  setActiveConversationId(value: string): void;
  setContent(value: string): void;
  setMessages(update: (current: ChatMessage[]) => ChatMessage[]): void;
  setSlashMenuOpen(value: boolean): void;
}

export interface MobileConsoleConfirmation {
  message: string;
  onCancel(): void;
  onConfirm(): void;
}

function replaceOptimisticMessage(
  current: ChatMessage[],
  optimisticId: string,
  authoritative: ChatMessage,
): ChatMessage[] {
  return upsertChatMessage(
    current.filter(({ id }) => id !== optimisticId),
    authoritative,
  );
}

export function useMobileConsoleController({
  activeConversationId,
  activeConversationIdRef,
  applyConversation,
  cacheOwner,
  cloudApi,
  conversationSyncGenerationRef,
  contentRef,
  isChinese,
  notify,
  profile,
  setActiveConversationId,
  setContent,
  setMessages,
  setSlashMenuOpen,
}: MobileConsoleControllerOptions) {
  const runningInvocationsRef = useRef(new Map<string, {
    conversationId: string;
    generation: number;
  }>());
  const [, setConsoleActivityRevision] = useState(0);
  const [confirmationMessage, setConfirmationMessage] = useState('');
  const confirmationRef = useRef<{
    conversationId: string;
    generation: number;
    ownsActiveView(): boolean;
    resolve(value: boolean): void;
  } | null>(null);
  const consoleRunning = consoleInvocationBlocksActiveView(
    runningInvocationsRef.current.values(),
    activeConversationIdRef.current,
    conversationSyncGenerationRef.current.active(),
  );

  const settleConfirmation = useCallback((accepted: boolean) => {
    const pending = confirmationRef.current;
    if (!pending) return;
    confirmationRef.current = null;
    setConfirmationMessage('');
    pending.resolve(accepted && pending.ownsActiveView());
  }, []);

  useEffect(() => {
    const pending = confirmationRef.current;
    if (!pending) return;
    if (
      pending.conversationId !== activeConversationId
      || pending.generation !== conversationSyncGenerationRef.current.active()
    ) settleConfirmation(false);
  }, [activeConversationId, conversationSyncGenerationRef, settleConfirmation]);

  useEffect(() => () => {
    const pending = confirmationRef.current;
    confirmationRef.current = null;
    pending?.resolve(false);
  }, []);

  const executeConsoleCommand = useCallback(async (draft: string): Promise<boolean> => {
    const line = draft.trim();
    if (!isRemoteConsoleCommand(line)) return false;
    if (!cloudApi) {
      notify(isChinese
        ? 'Hermes 服务器尚未连接，命令没有执行。'
        : 'Hermes is not connected. The command was not executed.');
      return true;
    }
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    if (!isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)) return true;
    const lifecycleCurrent = () => isConversationStorageEpochCurrent(cacheOwner, ownerEpoch);

    const invocationGeneration = conversationSyncGenerationRef.current.active();
    const invocationConversationId = activeConversationIdRef.current;
    if (consoleInvocationBlocksActiveView(
      runningInvocationsRef.current.values(),
      invocationConversationId,
      invocationGeneration,
    )) return true;
    const invocationId = uniqueTurnId('console-invocation');
    const invocationScope = {
      conversationId: invocationConversationId,
      generation: invocationGeneration,
    };
    runningInvocationsRef.current.set(invocationId, invocationScope);
    setConsoleActivityRevision((current) => current + 1);
    const createdAt = Date.now();
    const optimisticUserId = uniqueTurnId('console-user');
    const optimisticUser: ChatMessage = {
      avatarRole: 'user',
      content: line,
      createdAt,
      id: optimisticUserId,
      name: isChinese ? '你' : 'You',
      role: 'user',
      status: 'completed',
      updatedAt: createdAt,
    };
    setMessages((current) => upsertChatMessage(current, optimisticUser));
    contentRef.current = '';
    setContent('');
    setSlashMenuOpen(false);

    let conversationId = activeConversationIdRef.current;
    const ownsActiveView = () => consoleInvocationOwnsActiveView(
      activeConversationIdRef.current,
      conversationId,
      conversationSyncGenerationRef.current.active(),
      invocationGeneration,
    ) && isConversationStorageEpochCurrent(cacheOwner, ownerEpoch);
    let commandCompleted = false;
    try {
      if (!conversationId) {
        const clientId = `chat_${uniqueTurnId('console').replace(/[^A-Za-z0-9._:-]/g, '')}`;
        const created = await cloudApi.createConversation(
          profile,
          isChinese ? 'Hermes 命令行' : 'Hermes Console',
          clientId,
        );
        if (!lifecycleCurrent()) return true;
        conversationId = created.conversation.id;
        invocationScope.conversationId = conversationId;
        if (
          conversationSyncGenerationRef.current.isActiveCurrent(invocationGeneration)
          && activeConversationIdRef.current === invocationConversationId
        ) {
          activeConversationIdRef.current = conversationId;
          setActiveConversationId(conversationId);
        }
      }

      const userRecord = await cloudApi.recordConversationMessage(conversationId, {
        content: line,
        id: optimisticUserId,
        kind: 'console',
        name: isChinese ? '你' : 'You',
        role: 'user',
        status: 'completed',
      });
      if (!lifecycleCurrent()) return true;
      const authoritativeUser = collaborationMessageToView(userRecord.message, isChinese);
      if (authoritativeUser && ownsActiveView()) {
        setMessages((current) => replaceOptimisticMessage(
          current,
          optimisticUserId,
          authoritativeUser,
        ));
      }

      let result = await cloudApi.executeMobileConsoleCommand(line, profile, false);
      if (!lifecycleCurrent()) return true;
      if (result.status === 'confirm_required') {
        const accepted = await new Promise<boolean>((resolve) => {
          if (!ownsActiveView()) {
            resolve(false);
            return;
          }
          confirmationRef.current = {
            conversationId,
            generation: invocationGeneration,
            ownsActiveView,
            resolve,
          };
          setConfirmationMessage(result.confirmation_message || line);
        });
        result = accepted
          ? await cloudApi.executeMobileConsoleCommand(line, profile, true)
          : {
              ...result,
              output: isChinese ? '命令已取消。' : 'Command cancelled.',
              status: 'ok',
            };
        if (!lifecycleCurrent()) return true;
      }
      const output = mobileConsoleResultText(result, isChinese);
      const responseId = uniqueTurnId('console-result');
      const completedAt = Date.now();
      const localResponse: ChatMessage = {
        avatarRole: 'hermes',
        content: output,
        createdAt: completedAt,
        id: responseId,
        name: 'Hermes Console',
        role: 'assistant',
        status: result.status === 'error' ? 'failed' : 'completed',
        updatedAt: completedAt,
      };
      if (ownsActiveView()) {
        setMessages((current) => upsertChatMessage(current, localResponse));
      }
      commandCompleted = true;

      try {
        const response = await cloudApi.recordConversationMessage(conversationId, {
          content: output,
          id: responseId,
          kind: 'console',
          meta: { console_command: line, console_status: result.status },
          name: 'Hermes Console',
          role: 'assistant',
          status: result.status === 'error' ? 'failed' : 'completed',
        });
        if (!lifecycleCurrent()) return true;
        const responseView = collaborationMessageToView(response.message, isChinese);
        if (responseView && ownsActiveView()) {
          setMessages((current) => replaceOptimisticMessage(current, responseId, responseView));
        }
        const snapshot = await cloudApi.getConversation(conversationId);
        if (!lifecycleCurrent()) return true;
        if (ownsActiveView()) applyConversation(snapshot.conversation, ownerEpoch);
      } catch (syncError) {
        if (ownsActiveView()) {
          notify(isChinese
            ? `命令已执行，但会话同步失败：${serverFailure(syncError, true)}`
            : `The command ran, but conversation sync failed: ${serverFailure(syncError, false)}`);
        }
      }
    } catch (error) {
      if (!lifecycleCurrent()) return true;
      if (commandCompleted) return true;
      const detail = serverFailure(error, isChinese);
      const failedAt = Date.now();
      const failureId = uniqueTurnId('console-error');
      const failure: ChatMessage = {
        avatarRole: 'hermes',
        content: detail,
        createdAt: failedAt,
        id: failureId,
        name: 'Hermes Console',
        role: 'assistant',
        status: 'failed',
        updatedAt: failedAt,
      };
      if (ownsActiveView()) {
        setMessages((current) => upsertChatMessage(current, failure));
      }
      if (conversationId) {
        try {
          await cloudApi.recordConversationMessage(conversationId, {
            content: detail,
            id: failureId,
            kind: 'console',
            meta: { console_command: line, console_status: 'error' },
            name: 'Hermes Console',
            role: 'assistant',
            status: 'failed',
          });
          if (!lifecycleCurrent()) return true;
        } catch {
          // The visible error remains available even when the server cannot persist it.
        }
      }
    } finally {
      runningInvocationsRef.current.delete(invocationId);
      if (lifecycleCurrent()) {
        setConsoleActivityRevision((current) => current + 1);
      }
    }
    return true;
  }, [
    activeConversationIdRef,
    applyConversation,
    cacheOwner,
    cloudApi,
    conversationSyncGenerationRef,
    contentRef,
    isChinese,
    notify,
    profile,
    setActiveConversationId,
    setContent,
    setMessages,
    setSlashMenuOpen,
  ]);

  const consoleConfirmation: MobileConsoleConfirmation | null = confirmationMessage
    ? {
        message: confirmationMessage,
        onCancel: () => settleConfirmation(false),
        onConfirm: () => settleConfirmation(true),
      }
    : null;

  return { consoleConfirmation, consoleRunning, executeConsoleCommand };
}
