import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';

import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';

import { attachmentOutboxOwnerComponent } from './attachment-outbox-crypto';
import { attachmentOutboxRoot, remapLegacyOutboxUri } from './attachment-outbox-root';
import { cleanupOwnedTemporaryAttachments } from './attachment-draft-lifecycle';
import { purgeAttachmentDraftCache } from './attachment-draft-cache';
import { sharedConversationLocalStore } from './hermes-api-registry';
import { runLocalAccountPurgePhases } from './local-account-purge-order';
import { purgeManagedResourceCatalog } from './managed-resource-catalog';

export async function purgeLocalAccountData(owner: string): Promise<void> {
  const ownerDirectory = attachmentOutboxRoot(attachmentOutboxOwnerComponent(owner));
  // Files from pre-migration builds may still sit in the old Documents root
  // if the one-time native move was interrupted; purge covers both roots.
  const legacyOwnerDirectory = new ExpoDirectory(
    Paths.document,
    'hermes-outbox',
    attachmentOutboxOwnerComponent(owner),
  );
  const outboxRoot = attachmentOutboxRoot();
  const legacyOutboxRoot = new ExpoDirectory(Paths.document, 'hermes-outbox');
  const outboxRootUris = [...new Set([outboxRoot.uri, legacyOutboxRoot.uri])]
    .map((uri) => (uri.endsWith('/') ? uri : `${uri}/`));
  await runLocalAccountPurgePhases({
    async revokeEncryptionKey() {
      if (hasNativeIOSContext) {
        await HermesIOSContext.deleteAttachmentEncryptionKey(owner);
      }
    },
    async purgeData() {
      try {
        await sharedConversationLocalStore().purge(owner, async (pending) => {
          cleanupOwnedTemporaryAttachments(
            pending.flatMap((item) => (item.pendingAttachments || []).flatMap((attachment) => (
              attachment.sourceUri
                ? [{ ownedTemporary: attachment.ownedTemporary, uri: attachment.sourceUri }]
                : []
            ))),
            Paths.cache.uri,
            (uri) => {
              const source = new ExpoFile(uri);
              if (source.exists) source.delete();
            },
          );
          // Older builds used a short owner hash. Delete only request directories
          // referenced by this account's durable records; deleting the whole legacy
          // owner directory could cross an old hash collision. Records may point at
          // the pre-migration Documents location, so check both spellings of each URI.
          const legacyRequestDirectories = new Set<string>();
          for (const item of pending) {
            for (const attachment of item.pendingAttachments || []) {
              for (const uri of new Set([attachment.uri, remapLegacyOutboxUri(attachment.uri)])) {
                if (!outboxRootUris.some((root) => uri.startsWith(root))) continue;
                legacyRequestDirectories.add(uri.slice(0, uri.lastIndexOf('/') + 1));
              }
            }
          }
          for (const uri of legacyRequestDirectories) {
            const directory = new ExpoDirectory(uri);
            if (directory.exists) directory.delete();
          }
          // Delete the complete owner directory rather than only paths still present
          // in AsyncStorage. This also removes encrypted files orphaned by a process
          // kill between file installation and the outbox metadata update.
          if (ownerDirectory.exists) ownerDirectory.delete();
          if (legacyOwnerDirectory.exists) legacyOwnerDirectory.delete();
        });
        await purgeManagedResourceCatalog(owner);
      } finally {
        const draftPastePrefix = `hermes-paste-${attachmentOutboxOwnerComponent(owner)}-`;
        try {
          for (const entry of new ExpoDirectory(Paths.cache).list()) {
            if (entry instanceof ExpoFile && entry.name.startsWith(draftPastePrefix)) {
              entry.delete();
            }
          }
        } catch {
          // Draft paste files are account-scoped cache data; retry on the next purge.
        }
        try {
          purgeAttachmentDraftCache(owner);
        } catch {
          // The owner-scoped cache remains eligible for the next purge retry.
        }
      }
    },
  });
}
