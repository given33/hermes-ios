import { File as ExpoFile, Paths } from 'expo-file-system';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import { cleanupOwnedTemporaryAttachments } from '../../api/attachment-draft-lifecycle';
import type { HostedTurnPendingAttachment } from '../../api/conversation-local-store';
import type { ChatAttachment } from './chat-types';

/** Keeps attachment ownership and temporary-file cleanup out of chat flow logic. */
export function useChatAttachmentLifecycle({
  attachmentOwnerRef,
  attachmentsRef,
  cacheOwner,
  clearOptimisticHostedTurn,
  mountedRef,
  pendingAttachmentCleanup,
  setAttachments,
}: {
  attachmentOwnerRef: MutableRefObject<string>;
  attachmentsRef: MutableRefObject<ChatAttachment[]>;
  cacheOwner: string;
  clearOptimisticHostedTurn(): void;
  mountedRef: MutableRefObject<boolean>;
  pendingAttachmentCleanup: MutableRefObject<(() => void) | null>;
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>;
}) {
  const updateAttachments = useCallback((
    update: ChatAttachment[] | ((current: ChatAttachment[]) => ChatAttachment[]),
  ) => {
    setAttachments((current) => {
      const next = typeof update === 'function' ? update(current) : update;
      attachmentsRef.current = next;
      return next;
    });
  }, [attachmentsRef, setAttachments]);

  const cleanupAttachmentSources = useCallback((
    items: readonly ChatAttachment[] | readonly HostedTurnPendingAttachment[],
  ) => {
    if (Platform.OS === 'web') return;
    cleanupOwnedTemporaryAttachments(items.flatMap((item) => {
      const uri = 'sourceUri' in item ? item.sourceUri?.trim() : item.uri;
      return uri ? [{ ownedTemporary: item.ownedTemporary, uri }] : [];
    }), Paths.cache.uri, (uri) => {
      const file = new ExpoFile(uri);
      if (file.exists) file.delete();
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanupAttachmentSources(attachmentsRef.current);
      attachmentsRef.current = [];
      clearOptimisticHostedTurn();
      pendingAttachmentCleanup.current?.();
    };
  }, [
    attachmentsRef,
    cleanupAttachmentSources,
    clearOptimisticHostedTurn,
    mountedRef,
    pendingAttachmentCleanup,
  ]);

  useEffect(() => {
    if (attachmentOwnerRef.current === cacheOwner) return;
    cleanupAttachmentSources(attachmentsRef.current);
    attachmentOwnerRef.current = cacheOwner;
    updateAttachments([]);
  }, [
    attachmentOwnerRef,
    attachmentsRef,
    cacheOwner,
    cleanupAttachmentSources,
    updateAttachments,
  ]);

  return { cleanupAttachmentSources, updateAttachments };
}
