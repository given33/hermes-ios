import { Directory as ExpoDirectory, Paths } from 'expo-file-system';

import { HermesIOSContext, hasNativeIOSContext } from '../../modules/hermes-ios-context';

// The encrypted outbox lives in Application Support on iOS because
// UIFileSharingEnabled exposes everything under Documents in the Files app.
// The native vault owns the exact root; asking it (instead of rebuilding the
// path here) keeps JS and Swift from ever disagreeing about where encrypted
// envelopes belong. Platforms without the native module keep the historical
// Documents location, where no attachment encryption exists anyway.
let cachedRootUri: string | null | undefined;

function nativeOutboxRootUri(): string | null {
  if (cachedRootUri === undefined) {
    cachedRootUri = hasNativeIOSContext
      ? HermesIOSContext.getAttachmentOutboxRootUri()
      : null;
  }
  return cachedRootUri;
}

export function attachmentOutboxRoot(...components: string[]): ExpoDirectory {
  const rootUri = nativeOutboxRootUri();
  return rootUri
    ? new ExpoDirectory(rootUri, ...components)
    : new ExpoDirectory(Paths.document, 'hermes-outbox', ...components);
}

// Durable outbox records written by builds that kept the outbox in Documents
// still carry Documents URIs. The native vault migrates the files themselves,
// so those records must be re-pointed at the current root before any
// exists/encrypt/delete decision is made from them.
export function remapLegacyOutboxUri(uri: string): string {
  const legacyRoot = new ExpoDirectory(Paths.document, 'hermes-outbox');
  const legacyPrefix = withTrailingSlash(legacyRoot.uri);
  if (!uri.startsWith(legacyPrefix)) return uri;
  const currentPrefix = withTrailingSlash(attachmentOutboxRoot().uri);
  if (currentPrefix === legacyPrefix) return uri;
  return `${currentPrefix}${uri.slice(legacyPrefix.length)}`;
}

function withTrailingSlash(uri: string): string {
  return uri.endsWith('/') ? uri : `${uri}/`;
}
