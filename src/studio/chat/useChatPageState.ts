import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { TextInput } from 'react-native';

import type { SingleConversation } from '../../api/HermesCloudApi';
import { ConversationSyncGeneration } from '../../api/conversation-sync-generation';
import { HostedTurnDeliveryClaimRegistry } from '../../api/hosted-turn-delivery-state';
import type {
  ConversationCollaborationState,
  HermesChatViewMessage as ChatMessage,
} from '../../api/chat-view-model';
import { createInFlightActionGate } from '../in-flight-action-gate';
import type { ChatAttachment, PendingChatSend } from './chat-types';
import { usePendingTurnState } from './usePendingTurnState';

/**
 * Owns the mutable state and coordination refs for one mounted chat page.
 * Network, persistence, rendering, and state transitions remain in their
 * dedicated controllers; this hook is only the page-scoped state container.
 */
export function useChatPageState(cacheOwner: string) {
  const [content, setContent] = useState('');
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const setMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>((update) => {
    const next = typeof update === 'function' ? update(messagesRef.current) : update;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);
  const [conversations, setConversations] = useState<SingleConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState('');
  const [, setActiveHostedTurnId] = useState('');
  const [hostedRunning, setHostedRunning] = useState(false);
  const [sending, setSending] = useState(false);
  const pendingTurn = usePendingTurnState();
  const [collaborationState, setCollaborationState] = useState<ConversationCollaborationState>('single');
  const [cancellingHostedTurn, setCancellingHostedTurn] = useState(false);
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);

  const composerInputRef = useRef<TextInput>(null);
  const composerRevisionRef = useRef(0);
  const contentValueRef = useRef('');
  const contentRef = useMemo<MutableRefObject<string>>(() => {
    const revisioned = {} as MutableRefObject<string>;
    Object.defineProperty(revisioned, 'current', {
      configurable: false,
      enumerable: true,
      get: () => contentValueRef.current,
      set: (next: string) => {
        if (contentValueRef.current !== next) composerRevisionRef.current += 1;
        contentValueRef.current = next;
      },
    });
    return revisioned;
  }, []);
  const activeConversationIdRef = useRef('');
  const activeHostedTurnIdRef = useRef('');
  const cancelHostedTurnInFlightRef = useRef(false);
  const conversationIndexRef = useRef<SingleConversation[]>([]);
  const collaborationStateByConversationRef = useRef(
    new Map<string, ConversationCollaborationState>(),
  );
  const hostedEventCursorRef = useRef(new Map<string, number>());
  const hostedAccountGenerationRef = useRef(new Map<string, string>());
  const conversationSyncGenerationRef = useRef(new ConversationSyncGeneration());
  const pendingAttachmentCleanup = useRef<(() => void) | null>(null);
  const attachmentsRef = useRef<ChatAttachment[]>([]);
  const attachmentOwnerRef = useRef(cacheOwner);
  const sendSubmissionGateRef = useRef(createInFlightActionGate());
  const sendOperationGenerationRef = useRef(0);
  const pendingChatSendRef = useRef<PendingChatSend | null>(null);
  const cancelledPendingSendKeysRef = useRef(new Set<string>());
  const hostedTurnDeliveryClaimsRef = useRef(new HostedTurnDeliveryClaimRegistry());
  const mountedRef = useRef(true);

  return {
    activeConversationId,
    activeConversationIdRef,
    activeHostedTurnIdRef,
    attachmentOwnerRef,
    attachments,
    attachmentsOpen,
    attachmentsRef,
    cancelHostedTurnInFlightRef,
    cancelledPendingSendKeysRef,
    cancellingHostedTurn,
    collaborationState,
    collaborationStateByConversationRef,
    composerRevisionRef,
    composerInputRef,
    content,
    contentRef,
    conversationIndexRef,
    conversations,
    conversationSyncGenerationRef,
    historyCollapsed,
    historyModalOpen,
    hostedEventCursorRef,
    hostedAccountGenerationRef,
    hostedRunning,
    hostedTurnDeliveryClaimsRef,
    messages,
    messagesRef,
    mountedRef,
    pendingAttachmentCleanup,
    pendingChatSendRef,
    pendingTurn,
    sendOperationGenerationRef,
    sendSubmissionGateRef,
    sending,
    setActiveConversationId,
    setActiveHostedTurnId,
    setAttachments,
    setAttachmentsOpen,
    setCancellingHostedTurn,
    setCollaborationState,
    setContent,
    setConversations,
    setHistoryCollapsed,
    setHistoryModalOpen,
    setHostedRunning,
    setMessages,
    setSending,
  };
}
