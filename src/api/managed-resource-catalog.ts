import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  ManagedResourceCatalog,
  ManagedResourceRecord,
} from './cloud/extensions';
import {
  normalizeOwner,
  ownerStorageKey,
} from './conversation-storage-primitives';
import {
  beginConversationStorageOwnerPurge,
  captureConversationStorageEpoch,
  enqueueConversationStorageMaintenance,
  enqueueConversationStorageWrite,
  isConversationStorageEpochCurrent,
  isConversationStorageOwnerBlocked,
} from './conversation-storage-coordinator';

const CATALOG_PREFIX = 'hermes:managed-resource-catalog:v1:';
const CATALOG_VERSION = 1 as const;
const MAX_PAGES_PER_REFRESH = 100;

export interface ManagedResourceCatalogStorage {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
  setItem(key: string, value: string): Promise<void>;
}

interface StoredManagedResourceCatalog {
  accountGeneration: string;
  cursor: number;
  diagnostics: ManagedResourceCatalog['diagnostics'];
  resources: ManagedResourceRecord[];
  version: typeof CATALOG_VERSION;
}

type ManagedResourceCatalogFetcher = (
  cursor: number,
  limit: number,
  signal?: AbortSignal,
) => Promise<ManagedResourceCatalog>;

export function managedResourceCatalogKey(owner: string): string {
  return `${CATALOG_PREFIX}${ownerStorageKey(normalizeOwner(owner))}`;
}

export async function purgeManagedResourceCatalog(
  owner: string,
  storage: ManagedResourceCatalogStorage = AsyncStorage,
): Promise<void> {
  const normalizedOwner = normalizeOwner(owner);
  if (!normalizedOwner) return;
  if (!isConversationStorageOwnerBlocked(normalizedOwner)) {
    beginConversationStorageOwnerPurge(normalizedOwner);
  }
  await enqueueConversationStorageMaintenance(normalizedOwner, async () => {
    await storage.removeItem(managedResourceCatalogKey(normalizedOwner));
  });
}

/**
 * Account-scoped incremental cursor for the authoritative managed-resource catalog.
 *
 * Every response contains a full current resource projection, while `events` and
 * `cursor` let the client avoid replaying the entire event log. The full projection
 * deliberately replaces (rather than merges) the previous one so removals and an
 * account-generation transition cannot leave a resource from an old account alive.
 */
export class ManagedResourceCatalogController {
  private owner = '';
  private ownerEpoch = 0;
  private loadedOwner = '';
  private loadedOwnerEpoch = -1;
  private state: StoredManagedResourceCatalog | null = null;
  private refreshChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: ManagedResourceCatalogStorage = AsyncStorage,
  ) {}

  bindOwner(owner: string): void {
    const normalizedOwner = normalizeOwner(owner);
    const ownerEpoch = captureConversationStorageEpoch(normalizedOwner);
    if (normalizedOwner === this.owner && ownerEpoch === this.ownerEpoch) return;
    this.owner = normalizedOwner;
    this.ownerEpoch = ownerEpoch;
    this.loadedOwner = '';
    this.loadedOwnerEpoch = -1;
    this.state = null;
    this.refreshChain = Promise.resolve();
  }

  async refresh(
    fetchPage: ManagedResourceCatalogFetcher,
    limit = 500,
    signal?: AbortSignal,
  ): Promise<ManagedResourceCatalog> {
    const ownerAtStart = this.owner;
    const epochAtStart = captureConversationStorageEpoch(ownerAtStart);
    if (this.ownerEpoch !== epochAtStart) {
      this.ownerEpoch = epochAtStart;
      this.loadedOwner = '';
      this.loadedOwnerEpoch = -1;
      this.state = null;
      this.refreshChain = Promise.resolve();
    }
    if (!isConversationStorageEpochCurrent(ownerAtStart, epochAtStart)) {
      throw new Error('Hermes managed-resource account lifecycle is inactive');
    }
    let result!: ManagedResourceCatalog;
    const operation = this.refreshChain.catch(() => undefined).then(async () => {
      await this.load(ownerAtStart, epochAtStart);
      this.assertCurrent(ownerAtStart, epochAtStart);
      let workingState = this.state;
      let cursor = workingState?.cursor || 0;
      let pages = 0;
      const events: ManagedResourceCatalog['events'] = [];
      let resetCursor = false;
      let resetReason = '';

      while (true) {
        const requestedCursor = cursor;
        const page = normalizeCatalog(await fetchPage(requestedCursor, limit, signal));
        this.assertCurrent(ownerAtStart, epochAtStart);
        if (ownerAtStart && !page.account_generation) {
          throw new Error('Hermes managed-resource account generation is missing');
        }
        const generationChanged = Boolean(
          workingState?.accountGeneration
          && page.account_generation
          && workingState.accountGeneration !== page.account_generation,
        );
        const authoritativeReset = page.reset_cursor === true
          || generationChanged
          || page.cursor < requestedCursor;

        if (authoritativeReset) {
          events.length = 0;
          resetCursor = true;
          resetReason = page.reset_reason
            || (generationChanged ? 'account_generation_changed' : 'cursor_regressed');
        }
        events.push(...page.events);
        cursor = page.cursor;
        workingState = {
          accountGeneration: page.account_generation,
          cursor,
          diagnostics: page.diagnostics,
          resources: page.resources,
          version: CATALOG_VERSION,
        };
        const persisted = await this.persist(ownerAtStart, epochAtStart, workingState);
        if (!persisted) this.assertCurrent(ownerAtStart, epochAtStart);
        this.state = workingState;
        this.loadedOwner = ownerAtStart;
        this.loadedOwnerEpoch = epochAtStart;

        result = {
          ...page,
          events: [...events],
          reset_cursor: resetCursor || page.reset_cursor,
          reset_reason: resetReason || page.reset_reason,
        };
        pages += 1;
        if (!page.has_more) break;
        if (cursor <= requestedCursor) {
          throw new Error('Hermes managed-resource cursor did not advance');
        }
        if (pages >= MAX_PAGES_PER_REFRESH) {
          throw new Error('Hermes managed-resource catalog exceeded the refresh page limit');
        }
      }
    });
    this.refreshChain = operation;
    await operation;
    return result;
  }

  private async load(owner: string, epoch: number): Promise<void> {
    if (!owner || (this.loadedOwner === owner && this.loadedOwnerEpoch === epoch)) return;
    const stored = parseStoredCatalog(await this.storage.getItem(managedResourceCatalogKey(owner)));
    this.assertCurrent(owner, epoch);
    this.state = stored;
    this.loadedOwner = owner;
    this.loadedOwnerEpoch = epoch;
  }

  private async persist(
    owner: string,
    epoch: number,
    state: StoredManagedResourceCatalog,
  ): Promise<boolean> {
    if (!owner) return false;
    let persisted = false;
    await enqueueConversationStorageWrite(owner, async () => {
      await this.storage.setItem(managedResourceCatalogKey(owner), JSON.stringify(state));
      persisted = true;
    }, epoch);
    return persisted && isConversationStorageEpochCurrent(owner, epoch);
  }

  private assertCurrent(owner: string, epoch: number): void {
    if (
      this.owner !== owner
      || this.ownerEpoch !== epoch
      || !isConversationStorageEpochCurrent(owner, epoch)
    ) {
      throw new Error('Hermes managed-resource account lifecycle changed during refresh');
    }
  }
}

function normalizeCatalog(catalog: ManagedResourceCatalog): ManagedResourceCatalog {
  const cursor = Number(catalog?.cursor);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error('Hermes returned an invalid managed-resource cursor');
  }
  const accountGeneration = String(catalog?.account_generation || '').trim();
  return {
    account_generation: accountGeneration,
    cursor,
    diagnostics: Array.isArray(catalog?.diagnostics) ? catalog.diagnostics : [],
    events: Array.isArray(catalog?.events) ? catalog.events : [],
    has_more: catalog?.has_more === true,
    resources: Array.isArray(catalog?.resources) ? catalog.resources : [],
    reset_cursor: catalog?.reset_cursor === true,
    reset_reason: String(catalog?.reset_reason || ''),
  };
}

function parseStoredCatalog(raw: string | null): StoredManagedResourceCatalog | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredManagedResourceCatalog>;
    if (
      value.version !== CATALOG_VERSION
      || typeof value.accountGeneration !== 'string'
      || !Number.isSafeInteger(value.cursor)
      || Number(value.cursor) < 0
      || !Array.isArray(value.resources)
      || !Array.isArray(value.diagnostics)
    ) return null;
    return {
      accountGeneration: value.accountGeneration,
      cursor: Number(value.cursor),
      diagnostics: value.diagnostics,
      resources: value.resources,
      version: CATALOG_VERSION,
    };
  } catch {
    return null;
  }
}
