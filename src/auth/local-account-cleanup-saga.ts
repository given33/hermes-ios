import AsyncStorage from '@react-native-async-storage/async-storage';

const CLEANUP_KEY = 'hermes.native.account-cleanup.v1';
const cleanupChains = new WeakMap<object, Promise<void>>();

export interface LocalAccountCleanupRecord {
  createdAt: number;
  dataDone: boolean;
  nativeDone: boolean;
  owner: string;
  remoteDone: boolean;
}

export interface LocalAccountCleanupStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface LocalAccountCleanupTasks {
  deleteNativeOwner(owner: string): Promise<void>;
  purgeAccountData(owner: string): Promise<void>;
}

export class LocalAccountCleanupSaga {
  constructor(
    private readonly storage: LocalAccountCleanupStorage = AsyncStorage,
    private readonly now: () => number = Date.now,
  ) {}

  async begin(owner: string): Promise<LocalAccountCleanupRecord> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) throw new Error('Account cleanup owner is required');
    let record!: LocalAccountCleanupRecord;
    await this.mutate((records) => {
      const ownerKey = ownerIdentityKey(normalizedOwner);
      record = records.find((item) => ownerIdentityKey(item.owner) === ownerKey) || {
        createdAt: this.now(),
        dataDone: false,
        nativeDone: false,
        owner: normalizedOwner,
        remoteDone: false,
      };
      return [record, ...records.filter((item) => ownerIdentityKey(item.owner) !== ownerKey)];
    });
    return { ...record };
  }

  async pending(): Promise<LocalAccountCleanupRecord[]> {
    return this.read();
  }

  async markRemoteDone(owner: string): Promise<void> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) throw new Error('Account cleanup owner is required');
    const ownerKey = ownerIdentityKey(normalizedOwner);
    let record = (await this.read()).find((item) => ownerIdentityKey(item.owner) === ownerKey);
    if (!record) record = await this.begin(normalizedOwner);
    if (record.remoteDone) return;
    await this.replace({ ...record, remoteDone: true });
  }

  async run(owner: string, tasks: LocalAccountCleanupTasks): Promise<boolean> {
    const normalizedOwner = normalizeOwner(owner);
    if (!normalizedOwner) return true;
    const ownerKey = ownerIdentityKey(normalizedOwner);
    let [record] = (await this.read()).filter((item) => ownerIdentityKey(item.owner) === ownerKey);
    if (!record) record = await this.begin(normalizedOwner);
    if (!record.remoteDone) return false;
    const destructiveOwner = record.owner;

    if (!record.nativeDone) {
      try {
        await tasks.deleteNativeOwner(destructiveOwner);
        record = { ...record, nativeDone: true };
        await this.replace(record);
      } catch {
        // Continue with account data cleanup. Each phase is independently
        // durable so one subsystem never prevents the other from deleting.
      }
    }
    if (!record.dataDone) {
      try {
        await tasks.purgeAccountData(destructiveOwner);
        record = { ...record, dataDone: true };
        await this.replace(record);
      } catch {
        // The pending record is retried during the next cold start.
      }
    }
    if (!record.nativeDone || !record.dataDone) return false;
    await this.mutate((records) => (
      records.filter((item) => ownerIdentityKey(item.owner) !== ownerKey)
    ));
    return true;
  }

  async resume(tasks: LocalAccountCleanupTasks): Promise<string[]> {
    const remaining: string[] = [];
    for (const { owner } of await this.read()) {
      if (!await this.run(owner, tasks)) remaining.push(owner);
    }
    return remaining;
  }

  private async replace(record: LocalAccountCleanupRecord): Promise<void> {
    const ownerKey = ownerIdentityKey(record.owner);
    await this.mutate((records) => [
      record,
      ...records.filter((item) => ownerIdentityKey(item.owner) !== ownerKey),
    ]);
  }

  private async read(): Promise<LocalAccountCleanupRecord[]> {
    return parseRecords(await this.storage.getItem(CLEANUP_KEY));
  }

  private async mutate(
    operation: (records: LocalAccountCleanupRecord[]) => LocalAccountCleanupRecord[],
  ): Promise<void> {
    const identity = this.storage as object;
    const previous = cleanupChains.get(identity) || Promise.resolve();
    const next = previous.catch(() => undefined).then(async () => {
      const records = operation(parseRecords(await this.storage.getItem(CLEANUP_KEY)));
      await this.storage.setItem(CLEANUP_KEY, JSON.stringify({ version: 2, records }));
    });
    cleanupChains.set(identity, next);
    try {
      await next;
    } finally {
      if (cleanupChains.get(identity) === next) cleanupChains.delete(identity);
    }
  }
}

function parseRecords(raw: string | null): LocalAccountCleanupRecord[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (
      !isRecord(value)
      || (value.version !== 1 && value.version !== 2)
      || !Array.isArray(value.records)
    ) return [];
    const legacyRemoteDone = value.version === 1;
    return value.records.flatMap((candidate) => {
      if (!isRecord(candidate)) return [];
      const owner = normalizeOwner(candidate.owner);
      if (!owner) return [];
      return [{
        createdAt: finiteNumber(candidate.createdAt) || Date.now(),
        dataDone: candidate.dataDone === true,
        nativeDone: candidate.nativeDone === true,
        owner,
        remoteDone: legacyRemoteDone || candidate.remoteDone === true,
      }];
    });
  } catch {
    return [];
  }
}

function normalizeOwner(value: unknown): string {
  // The native event queue and attachment vault key by the exact owner scope.
  // Preserve it for destructive work; callers may canonicalize only while
  // comparing records.
  return typeof value === 'string' ? value.trim() : '';
}

function ownerIdentityKey(value: unknown): string {
  return normalizeOwner(value).toLowerCase();
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
