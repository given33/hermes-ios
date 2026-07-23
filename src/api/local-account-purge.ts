import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';

import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';

import { attachmentOutboxOwnerComponent } from './attachment-outbox-crypto';
import { cleanupOwnedTemporaryAttachments } from './attachment-draft-lifecycle';
import { ConversationLocalStore } from './conversation-local-store';
import { runLocalAccountPurgePhases } from './local-account-purge-order';

export async function purgeLocalAccountData(owner: string): Promise<void> {
  const ownerDirectory = new ExpoDirectory(
    Paths.document,
    'hermes-outbox',
    attachmentOutboxOwnerComponent(owner),
  );
  const outboxRoot = new ExpoDirectory(Paths.document, 'hermes-outbox');
  const outboxRootUri = outboxRoot.uri.endsWith('/') ? outboxRoot.uri : `${outboxRoot.uri}/`;
  await runLocalAccountPurgePhases({
    async revokeEncryptionKey() {
      if (hasNativeIOSContext) {
        await HermesIOSContext.deleteAttachmentEncryptionKey(owner);
      }
    },
    async purgeData() {
      try {
        await new ConversationLocalStore().purge(owner, async (pending) => {
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
          // owner directory could cross an old hash collision.
          const legacyRequestDirectories = new Set<string>();
          for (const item of pending) {
            for (const attachment of item.pendingAttachments || []) {
              if (!attachment.uri.startsWith(outboxRootUri)) continue;
              legacyRequestDirectories.add(
                attachment.uri.slice(0, attachment.uri.lastIndexOf('/') + 1),
              );
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
        });
      } finally {
        for (const pickerCacheName of ['DocumentPicker', 'ImagePicker']) {
          try {
            const pickerCache = new ExpoDirectory(Paths.cache, pickerCacheName);
            if (pickerCache.exists) pickerCache.delete();
          } catch {
            // Picker caches are ephemeral; key revocation remains authoritative.
          }
        }
      }
    },
  });
}
