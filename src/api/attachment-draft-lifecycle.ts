export interface TemporaryAttachmentSource {
  ownedTemporary?: boolean;
  uri: string;
}

export function isUriInsideDirectory(uri: string, directoryUri: string): boolean {
  try {
    const candidate = new URL(uri);
    const directory = new URL(
      directoryUri.endsWith('/') ? directoryUri : `${directoryUri}/`,
    );
    if (
      candidate.protocol !== directory.protocol
      || candidate.host !== directory.host
    ) {
      return false;
    }
    const rootPath = directory.pathname.endsWith('/')
      ? directory.pathname
      : `${directory.pathname}/`;
    return candidate.pathname.startsWith(rootPath)
      && candidate.pathname.length > rootPath.length;
  } catch {
    return false;
  }
}

export function cleanupOwnedTemporaryAttachments(
  attachments: readonly TemporaryAttachmentSource[],
  cacheDirectoryUri: string,
  remove: (uri: string) => void,
): void {
  const handled = new Set<string>();
  for (const attachment of attachments) {
    if (
      !attachment.ownedTemporary
      || handled.has(attachment.uri)
      || !isUriInsideDirectory(attachment.uri, cacheDirectoryUri)
    ) {
      continue;
    }
    handled.add(attachment.uri);
    try {
      remove(attachment.uri);
    } catch {
      // Cache cleanup is best-effort and must not invalidate durable state.
    }
  }
}
