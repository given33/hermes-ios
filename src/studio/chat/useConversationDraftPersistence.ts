import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

import type { ConversationLocalStore } from '../../api/conversation-local-store';
import type { ConversationDraftAttachment } from '../../api/conversation-draft-repository';
import {
  captureConversationStorageEpoch,
  isConversationStorageEpochCurrent,
} from '../../api/conversation-storage-coordinator';
import {
  canApplyHydratedDraft,
  conversationDraftScope,
  persistedDraftTarget,
  type ConversationDraftScope,
} from './conversation-draft-scope';
import type { ChatAttachment } from './chat-types';

const DRAFT_WRITE_DEBOUNCE_MS = 250;

export function useConversationDraftPersistence({
  activeConversationId,
  attachments,
  attachmentsRef,
  cacheOwner,
  cleanupAttachmentSources,
  content,
  contentRef,
  composerRevisionRef,
  localStore,
  setContent,
  updateAttachments,
}: {
  activeConversationId: string;
  attachments: readonly ChatAttachment[];
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  cacheOwner: string;
  composerRevisionRef: MutableRefObject<number>;
  cleanupAttachmentSources(items: readonly ChatAttachment[]): void;
  content: string;
  contentRef: MutableRefObject<string>;
  localStore: ConversationLocalStore | null;
  setContent: Dispatch<SetStateAction<string>>;
  updateAttachments(update: ChatAttachment[]): void;
}): void {
  const activeScopeRef = useRef<ConversationDraftScope>(conversationDraftScope('', ''));
  const activeScopeEpochRef = useRef(0);
  const hydratingRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const previous = persistedDraftTarget(activeScopeRef.current);
    const previousEpoch = activeScopeEpochRef.current;
    const previousContent = contentRef.current;
    const previousAttachments = persistentDraftAttachments(attachmentsRef.current);
    if (localStore && previous) {
      void localStore.writeDraft(
        previous.owner,
        previous.conversationId,
        previousContent,
        previousAttachments,
        previousEpoch,
      );
    }
    activeScopeRef.current = conversationDraftScope(cacheOwner, activeConversationId);
    const ownerEpoch = captureConversationStorageEpoch(cacheOwner);
    activeScopeEpochRef.current = ownerEpoch;
    generationRef.current += 1;
    const generation = generationRef.current;
    hydratingRef.current = true;
    contentRef.current = '';
    setContent('');
    cleanupAttachmentSources(
      attachmentsRef.current.filter((attachment) => !attachment.draftPersistent),
    );
    updateAttachments([]);
    const hydrationRevision = composerRevisionRef.current;
    if (!localStore || !cacheOwner || !activeConversationId) {
      hydratingRef.current = false;
      return undefined;
    }
    void localStore.readDraft(cacheOwner, activeConversationId).then((draft) => {
      const expectedScope = conversationDraftScope(cacheOwner, activeConversationId);
      const scopeStillCurrent = generationRef.current === generation
        && isConversationStorageEpochCurrent(cacheOwner, ownerEpoch)
        && activeScopeRef.current.owner === expectedScope.owner
        && activeScopeRef.current.conversationId === expectedScope.conversationId;
      if (!scopeStillCurrent) return;
      const restored = draft?.content || '';
      const applyHydratedContent = canApplyHydratedDraft(
        generation,
        generationRef.current,
        expectedScope,
        activeScopeRef.current,
        hydrationRevision,
        composerRevisionRef.current,
      );
      if (applyHydratedContent) {
        contentRef.current = restored;
        setContent(restored);
        updateAttachments((draft?.attachments || []).map((attachment) => ({
          ...attachment,
        })));
      }
      hydratingRef.current = false;
      if (!applyHydratedContent) {
        void localStore.writeDraft(
          cacheOwner,
          activeConversationId,
          contentRef.current,
          persistentDraftAttachments(attachmentsRef.current),
          ownerEpoch,
        );
      }
    }).catch(() => {
      if (generationRef.current !== generation) return;
      hydratingRef.current = false;
      void localStore.writeDraft(
        cacheOwner,
        activeConversationId,
        contentRef.current,
        persistentDraftAttachments(attachmentsRef.current),
        ownerEpoch,
      );
    });
    return () => {
      if (generationRef.current !== generation) return;
      const target = persistedDraftTarget(activeScopeRef.current);
      if (localStore && target) {
        void localStore.writeDraft(
          target.owner,
          target.conversationId,
          contentRef.current,
          persistentDraftAttachments(attachmentsRef.current),
          activeScopeEpochRef.current,
        );
      }
      generationRef.current += 1;
    };
  }, [
    activeConversationId,
    attachmentsRef,
    cacheOwner,
    cleanupAttachmentSources,
    composerRevisionRef,
    contentRef,
    localStore,
    setContent,
    updateAttachments,
  ]);

  useEffect(() => {
    if (
      hydratingRef.current
      || !localStore
      || !cacheOwner
      || !activeConversationId
      || activeScopeRef.current.owner !== cacheOwner
      || activeScopeRef.current.conversationId !== activeConversationId
    ) return undefined;
    const timer = setTimeout(() => {
      const ownerEpoch = activeScopeEpochRef.current;
      void localStore.writeDraft(
        cacheOwner,
        activeConversationId,
        content,
        persistentDraftAttachments(attachments),
        ownerEpoch,
      );
    }, DRAFT_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [activeConversationId, attachments, cacheOwner, content, localStore]);
}

function persistentDraftAttachments(
  attachments: readonly ChatAttachment[],
): ConversationDraftAttachment[] {
  return attachments.flatMap((attachment) => (
    attachment.draftPersistent ? [{ ...attachment, draftPersistent: true as const }] : []
  ));
}
