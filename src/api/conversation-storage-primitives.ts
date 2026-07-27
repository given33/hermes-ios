import type { ConversationStorageAdapter } from './conversation-store-types';

export function normalizeOwner(value: unknown): string {
  return stringValue(value).toLowerCase();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function ownerStorageKey(owner: string): string {
  return hexStorageKey('u', owner);
}

export function conversationStorageKey(conversationId: string): string {
  return hexStorageKey('c', conversationId);
}

export function legacyOwnerHash(owner: string): string {
  let hash = 0x811c9dc5;
  for (const character of owner) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export async function readCurrentOrLegacy(
  storage: ConversationStorageAdapter,
  currentKey: string,
  legacyKey: string,
): Promise<string | null> {
  return (await storage.getItem(currentKey)) ?? storage.getItem(legacyKey);
}

function hexStorageKey(prefix: string, value: string): string {
  let encoded = prefix;
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return encoded;
}
