import { useCallback, useState, type MutableRefObject } from 'react';
import { Alert } from 'react-native';

import type { HermesCloudApi, SingleConversation } from '../../api/HermesCloudApi';
import {
  collaborationMessageToView,
  upsertChatMessage,
  type HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { serverFailure, uniqueTurnId } from './chat-domain';
import { isRemoteConsoleCommand, mobileConsoleResultText } from './mobile-console-model';

interface MobileConsoleControllerOptions {
  activeConversationIdRef: MutableRefObject<string>;
  applyConversation(conversation: SingleConversation): void;
  cloudApi: HermesCloudApi | null;
  contentRef: MutableRefObject<string>;
  isChinese: boolean;
  notify(message: string): void;
  profile: string;
  setActiveConversationId(value: string): void;
  setContent(value: string): void;
  setMessages(update: (current: ChatMessage[]) => ChatMessage[]): void;
  setSlashMenuOpen(value: boolean): void;
}

function confirmConsoleMutation(message: string, isChinese: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      isChinese ? '确认执行命令' : 'Confirm command',
      message,
      [
        {
          onPress: () => resolve(false),
          style: 'cancel',
          text: isChinese ? '取消' : 'Cancel',
        },
        {
          onPress: () => resolve(true),
          text: isChinese ? '执行' : 'Run',
        },
      ],
      { cancelable: false },
    );
  });
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
  activeConversationIdRef,
  applyConversation,
  cloudApi,
  contentRef,
  isChinese,
  notify,
  profile,
  setActiveConversationId,
  setContent,
  setMessages,
  setSlashMenuOpen,
}: MobileConsoleControllerOptions) {
  const [consoleRunning, setConsoleRunning] = useState(false);

  const executeConsoleCommand = useCallback(async (draft: string): Promise<boolean> => {
    const line = draft.trim();
    if (!isRemoteConsoleCommand(line)) return false;
    if (consoleRunning) return true;
    if (!cloudApi) {
      notify(isChinese
        ? 'Hermes 服务器尚未连接，命令没有执行。'
        : 'Hermes is not connected. The command was not executed.');
      return true;
    }

    setConsoleRunning(true);
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
    let commandCompleted = false;
    try {
      if (!conversationId) {
        const clientId = `chat_${uniqueTurnId('console').replace(/[^A-Za-z0-9._:-]/g, '')}`;
        const created = await cloudApi.createConversation(
          profile,
          isChinese ? 'Hermes 命令行' : 'Hermes Console',
          clientId,
        );
        conversationId = created.conversation.id;
        activeConversationIdRef.current = conversationId;
        setActiveConversationId(conversationId);
      }

      const userRecord = await cloudApi.recordConversationMessage(conversationId, {
        content: line,
        id: optimisticUserId,
        kind: 'console',
        name: isChinese ? '你' : 'You',
        role: 'user',
        status: 'completed',
      });
      const authoritativeUser = collaborationMessageToView(userRecord.message, isChinese);
      if (authoritativeUser) {
        setMessages((current) => replaceOptimisticMessage(
          current,
          optimisticUserId,
          authoritativeUser,
        ));
      }

      let result = await cloudApi.executeMobileConsoleCommand(line, profile, false);
      if (result.status === 'confirm_required') {
        const accepted = await confirmConsoleMutation(
          result.confirmation_message || line,
          isChinese,
        );
        result = accepted
          ? await cloudApi.executeMobileConsoleCommand(line, profile, true)
          : {
              ...result,
              output: isChinese ? '命令已取消。' : 'Command cancelled.',
              status: 'ok',
            };
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
      setMessages((current) => upsertChatMessage(current, localResponse));
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
        const responseView = collaborationMessageToView(response.message, isChinese);
        if (responseView) {
          setMessages((current) => replaceOptimisticMessage(current, responseId, responseView));
        }
        const snapshot = await cloudApi.getConversation(conversationId);
        applyConversation(snapshot.conversation);
      } catch (syncError) {
        notify(isChinese
          ? `命令已执行，但会话同步失败：${serverFailure(syncError, true)}`
          : `The command ran, but conversation sync failed: ${serverFailure(syncError, false)}`);
      }
    } catch (error) {
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
      setMessages((current) => upsertChatMessage(current, failure));
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
        } catch {
          // The visible error remains available even when the server cannot persist it.
        }
      }
    } finally {
      setConsoleRunning(false);
    }
    return true;
  }, [
    activeConversationIdRef,
    applyConversation,
    cloudApi,
    consoleRunning,
    contentRef,
    isChinese,
    notify,
    profile,
    setActiveConversationId,
    setContent,
    setMessages,
    setSlashMenuOpen,
  ]);

  return { consoleRunning, executeConsoleCommand };
}
