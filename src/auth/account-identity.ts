import type { SavedConnection } from './credential-contract';

export const LEGACY_ACCOUNT_GENERATION = 'legacy';

export function normalizeAccountGeneration(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function requireAccountGeneration(value: unknown): string {
  const generation = normalizeAccountGeneration(value);
  if (!generation || generation === LEGACY_ACCOUNT_GENERATION) {
    throw new Error('Hermes account generation is required');
  }
  return generation;
}

export function legacyAccountOwnerScope(
  connection: Pick<SavedConnection, 'baseUrl' | 'username'>,
): string {
  return `${connection.baseUrl}|${connection.username}`;
}

export function accountOwnerScope(
  connection: Pick<SavedConnection, 'baseUrl' | 'username' | 'accountGeneration'>,
): string {
  return `${legacyAccountOwnerScope(connection)}|${requireAccountGeneration(
    connection.accountGeneration,
  )}`;
}

export function accountGenerationFromOwnerScope(ownerScope: string): string {
  const separator = ownerScope.lastIndexOf('|');
  if (separator < 0) return LEGACY_ACCOUNT_GENERATION;
  const generation = normalizeAccountGeneration(ownerScope.slice(separator + 1));
  return generation.startsWith('acctgen_') ? generation : LEGACY_ACCOUNT_GENERATION;
}
