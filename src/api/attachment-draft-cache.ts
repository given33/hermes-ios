import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';

import { attachmentOutboxOwnerComponent } from './attachment-outbox-crypto';

const DRAFT_CACHE_DIRECTORY = 'hermes-drafts';

export function attachmentDraftCacheRoot(owner: string): ExpoDirectory {
  return new ExpoDirectory(
    Paths.cache,
    DRAFT_CACHE_DIRECTORY,
    attachmentOutboxOwnerComponent(owner || 'local'),
  );
}

export function copyAttachmentIntoDraftCache(
  owner: string,
  sourceUri: string,
  name: string,
  identity: string,
): string {
  const directory = attachmentDraftCacheRoot(owner);
  directory.create({ idempotent: true, intermediates: true });
  const target = new ExpoFile(
    directory,
    `${safeDraftComponent(identity)}-${safeDraftComponent(name)}`,
  );
  const source = new ExpoFile(sourceUri);
  if (!source.exists) throw new Error(`Attachment source is unavailable: ${name}`);
  source.copy(target);
  return target.uri;
}

export function writeTextIntoDraftCache(
  owner: string,
  name: string,
  content: string,
): string {
  const directory = attachmentDraftCacheRoot(owner);
  directory.create({ idempotent: true, intermediates: true });
  const target = new ExpoFile(directory, safeDraftComponent(name));
  target.write(content);
  return target.uri;
}

export function purgeAttachmentDraftCache(owner: string): void {
  const directory = attachmentDraftCacheRoot(owner);
  if (directory.exists) directory.delete();
}

function safeDraftComponent(value: string): string {
  const safe = value
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 180);
  return safe || 'attachment';
}
