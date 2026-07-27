import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { HermesIOSContext } from '../../../modules/hermes-ios-context';
import {
  cleanupOwnedTemporaryAttachments,
  isUriInsideDirectory,
} from '../../api/attachment-draft-lifecycle';
import {
  ATTACHMENT_ENCRYPTION_FORMAT,
  attachmentOutboxOwnerComponent,
  encryptedAttachmentUri,
  withAttachmentPersistenceRollback,
} from '../../api/attachment-outbox-crypto';
import { attachmentOutboxRoot, remapLegacyOutboxUri } from '../../api/attachment-outbox-root';
import type {
  HostedTurnOutboxItem,
  HostedTurnPendingAttachment,
} from '../../api/conversation-local-store';
import { hostedTurnDeliveryClaimKey } from '../../api/hosted-turn-delivery-state';
import { attachmentContext, type HermesChatViewMessage as ChatMessage } from '../../api/chat-view-model';
import { isRecord, uniqueTurnId } from './chat-domain';
import type { ChatAttachment, PendingChatSend } from './chat-types';

export function formatAttachmentSize(size?: number | null): string {
  if (!size || size < 1) return '—';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function cleanupUnreferencedPickerCacheFiles(
  protectedSources: readonly { ownedTemporary?: boolean; uri: string }[],
): void {
  if (Platform.OS === 'web') return;
  const protectedUris = new Set(protectedSources.flatMap((source) => {
    if (!source.ownedTemporary || !isUriInsideDirectory(source.uri, Paths.cache.uri)) return [];
    try {
      return [new URL(source.uri).href];
    } catch {
      return [];
    }
  }));
  const sweep = (directory: ExpoDirectory) => {
    if (!directory.exists) return;
    for (const entry of directory.list()) {
      try {
        if (entry instanceof ExpoDirectory) {
          sweep(entry);
          if (entry.exists && entry.list().length === 0) entry.delete();
          continue;
        }
        const normalized = new URL(entry.uri).href;
        if (!protectedUris.has(normalized) && entry.exists) entry.delete();
      } catch {
        // A later replay or account cleanup retries inaccessible entries.
      }
    }
  };
  for (const name of ['DocumentPicker', 'ImagePicker']) {
    try {
      sweep(new ExpoDirectory(Paths.cache, name));
    } catch {
      // Picker caches are ephemeral; cleanup remains best-effort.
    }
  }
}

export function resolveComposerFontSize(value: string): number {
  const glyphCount = Array.from(value).length;
  if (glyphCount <= 28 || /\s/u.test(value)) return 16;
  return Math.max(12, 16 - (Math.min(glyphCount, 40) - 28) / 3);
}

export function safeOutboxPathComponent(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '');
  return safe.slice(0, 120) || 'pending';
}

export function planPendingAttachments(
  owner: string,
  requestId: string,
  attachments: readonly ChatAttachment[],
): HostedTurnPendingAttachment[] {
  if (!attachments.length) return [];
  const directory = attachmentOutboxRoot(
    attachmentOutboxOwnerComponent(owner),
    safeOutboxPathComponent(requestId),
  );
  return attachments.map((attachment, index) => ({
    encryption: ATTACHMENT_ENCRYPTION_FORMAT,
    id: uniqueTurnId(`upload-${index}`),
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    name: attachment.name,
    ownedTemporary: attachment.ownedTemporary,
    size: attachment.size,
    sourceUri: attachment.uri,
    uri: new ExpoFile(
      directory,
      `${index}-${safeOutboxPathComponent(attachment.name)}.hermes-encrypted`,
    ).uri,
  }));
}

export async function persistPendingAttachments(
  owner: string,
  requestId: string,
  attachments: readonly HostedTurnPendingAttachment[],
): Promise<HostedTurnPendingAttachment[]> {
  if (!attachments.length) return [];
  const directory = attachmentOutboxRoot(
    attachmentOutboxOwnerComponent(owner),
    safeOutboxPathComponent(requestId),
  );
  directory.create({ idempotent: true, intermediates: true });
  const installedTargets = new Set<string>();
  return withAttachmentPersistenceRollback(async () => {
    const persisted: HostedTurnPendingAttachment[] = [];
    for (const attachment of attachments) {
      const recordedUri = remapLegacyOutboxUri(attachment.uri);
      const targetUri = attachment.encryption === ATTACHMENT_ENCRYPTION_FORMAT
        ? recordedUri
        : encryptedAttachmentUri(recordedUri);
      const target = new ExpoFile(targetUri);
      const legacyPlaintext = attachment.encryption
        ? null
        : [recordedUri, attachment.uri]
            .map((uri) => new ExpoFile(uri))
            .find((file) => file.exists) ?? null;
      const sourceUri = legacyPlaintext ? legacyPlaintext.uri : attachment.sourceUri?.trim();
      if (!target.exists) {
        if (!sourceUri) throw new Error(`Attachment source is unavailable: ${attachment.name}`);
        await HermesIOSContext.encryptAttachment(owner, sourceUri, targetUri);
        installedTargets.add(targetUri);
      }
      persisted.push({
        ...attachment,
        encryption: ATTACHMENT_ENCRYPTION_FORMAT,
        sourceUri: sourceUri || '',
        uri: targetUri,
      });
    }
    return persisted;
  }, () => {
    for (const uri of installedTargets) {
      const file = new ExpoFile(uri);
      if (file.exists) file.delete();
    }
  });
}

export function cleanupPendingAttachments(item: HostedTurnOutboxItem): void {
  if (Platform.OS === 'web') return;
  const root = attachmentOutboxRoot();
  const rootUri = root.uri.endsWith('/') ? root.uri : `${root.uri}/`;
  cleanupOwnedTemporaryAttachments(
    (item.pendingAttachments || []).flatMap((attachment) => (
      attachment.sourceUri
        ? [{ ownedTemporary: attachment.ownedTemporary, uri: attachment.sourceUri }]
        : []
    )),
    Paths.cache.uri,
    (uri) => {
      const source = new ExpoFile(uri);
      if (source.exists) source.delete();
    },
  );
  const recordedUris = (item.pendingAttachments || []).map(({ uri }) => remapLegacyOutboxUri(uri));
  for (const uri of recordedUris) {
    if (!uri.startsWith(rootUri)) continue;
    const file = new ExpoFile(uri);
    if (file.exists) file.delete();
  }
  const firstTarget = recordedUris.find((uri) => uri.startsWith(rootUri));
  if (firstTarget) {
    const requestDirectoryUri = firstTarget.slice(0, firstTarget.lastIndexOf('/') + 1);
    const requestDirectory = new ExpoDirectory(requestDirectoryUri);
    if (requestDirectory.exists) requestDirectory.delete();
  }
}

export function hydrateOutboxInput(item: HostedTurnOutboxItem): HostedTurnOutboxItem {
  const uploaded = (item.pendingAttachments || []).flatMap((attachment) => (
    attachment.uploaded ? [attachment.uploaded] : []
  ));
  return {
    ...item,
    input: {
      ...item.input,
      attachmentContext: attachmentContext(uploaded),
      attachmentIds: uploaded.flatMap((attachment) => (
        typeof attachment.id === 'string' ? [attachment.id] : []
      )),
      message: {
        ...item.input.message,
        meta: {
          ...(isRecord(item.input.message.meta) ? item.input.message.meta : {}),
          attachments: uploaded,
        },
      },
    },
  };
}

export function pendingChatSendFromOutbox(
  item: HostedTurnOutboxItem,
  owner: string,
): PendingChatSend {
  const source = item.input.message;
  const createdAt = typeof source.created_at === 'number' ? source.created_at : item.queuedAt;
  const userMessage: ChatMessage = {
    avatarRole: 'user',
    content: source.content,
    createdAt,
    durationMs: 0,
    id: source.id,
    name: source.name || 'You',
    role: 'user',
    status: source.status || 'completed',
    updatedAt: typeof source.updated_at === 'number' ? source.updated_at : createdAt,
  };
  return {
    conversationId: item.conversationId,
    key: hostedTurnDeliveryClaimKey(owner, source.id),
    queuedItem: item,
    userMessage,
  };
}
