import { File as ExpoFile, Paths } from 'expo-file-system';

import { ConversationLocalStore } from './conversation-local-store';

export async function purgeLocalAccountData(owner: string): Promise<void> {
  const { document: storageDirectory } = Paths;
  const rootUri = storageDirectory.uri.endsWith('/')
    ? `${storageDirectory.uri}hermes-outbox/`
    : `${storageDirectory.uri}/hermes-outbox/`;
  await new ConversationLocalStore().purge(owner, async (pending) => {
    const failures: unknown[] = [];
    const seen = new Set<string>();
    for (const item of pending) {
      for (const attachment of item.pendingAttachments || []) {
        if (!attachment.uri.startsWith(rootUri) || seen.has(attachment.uri)) continue;
        seen.add(attachment.uri);
        try {
          const file = new ExpoFile(attachment.uri);
          if (file.exists) file.delete();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length) {
      throw new Error(`Failed to purge ${failures.length} pending attachment file(s)`);
    }
  });
}
