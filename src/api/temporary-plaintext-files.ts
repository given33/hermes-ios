import { Directory as ExpoDirectory, File as ExpoFile, Paths } from 'expo-file-system';

import { initializePlaintextDirectory } from './temporary-plaintext-lifecycle';

const PLAINTEXT_PREVIEW_DIRECTORY = 'hermes-plaintext-previews-v1';
const lifecycle = { initialized: false };
let nextIdentity = 0;

function plaintextDirectory(): ExpoDirectory {
  return new ExpoDirectory(Paths.cache, PLAINTEXT_PREVIEW_DIRECTORY);
}

export function initializeTemporaryPlaintextFiles(): void {
  initializePlaintextDirectory(plaintextDirectory(), lifecycle);
}

export function temporaryPlaintextFile(name: string, purpose: string): ExpoFile {
  const directory = plaintextDirectory();
  initializePlaintextDirectory(directory, lifecycle);
  nextIdentity += 1;
  return new ExpoFile(
    directory,
    `${safeComponent(purpose)}-${Date.now().toString(36)}-${nextIdentity.toString(36)}`
      + `-${safeComponent(name)}`,
  );
}

function safeComponent(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 160);
  return normalized || 'file';
}
