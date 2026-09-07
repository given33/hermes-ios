import type { ConversationStorageAdapter } from './conversation-store-types';

const DATABASE = 'hermes-conversation-cache';
const STORE = 'entries';
const CACHE_KEY = /^hermes\.native\.conversations\.v[1-4]\./;

/** Web transcript storage. Drafts, credentials and outboxes keep their own adapter. */
export class IndexedConversationCacheStorage implements ConversationStorageAdapter {
  private database: Promise<IDBDatabase> | undefined;
  private readonly operations = new Map<string, Promise<unknown>>();

  constructor(private readonly legacy: ConversationStorageAdapter, private readonly factory: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(DATABASE, 1);
        let blocked = false;
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onerror = () => { this.database = undefined; reject(request.error); };
        request.onblocked = () => {
          blocked = true;
          this.database = undefined;
          reject(new Error('Conversation cache upgrade blocked by another tab'));
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) { db.close(); return; }
          db.onversionchange = () => { db.close(); this.database = undefined; };
          resolve(db);
        };
      }).catch((error) => {
        this.database = undefined;
        throw error;
      });
    }
    return this.database;
  }

  private async transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode, { durability: 'strict' });
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error || request.error || new Error('Conversation cache transaction aborted'));
      transaction.onerror = () => { /* onabort reports the final transaction outcome. */ };
    });
  }

  private serialize<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(key) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.operations.set(key, next);
    void next.finally(() => {
      if (this.operations.get(key) === next) this.operations.delete(key);
    }).catch(() => undefined);
    return next;
  }

  getItem(key: string): Promise<string | null> {
    if (!CACHE_KEY.test(key)) return this.legacy.getItem(key);
    return this.serialize(key, async () => {
      const current = await this.transaction('readonly', (store) => store.get(key));
      if (typeof current === 'string') {
        await this.legacy.removeItem(key);
        return current;
      }
      const old = await this.legacy.getItem(key);
      if (old === null) return null;
      const newer = await this.transaction('readwrite', (store) => {
        const request = store.get(key);
        request.onsuccess = () => {
          if (typeof request.result !== 'string') store.put(old, key);
        };
        return request;
      });
      // Remove only the migrated key after the database transaction commits.
      await this.legacy.removeItem(key);
      return typeof newer === 'string' ? newer : old;
    });
  }

  setItem(key: string, value: string): Promise<void> {
    if (!CACHE_KEY.test(key)) return this.legacy.setItem(key, value);
    return this.serialize(key, async () => {
      await this.transaction('readwrite', (store) => store.put(value, key));
      await this.legacy.removeItem(key);
    });
  }

  removeItem(key: string): Promise<void> {
    if (!CACHE_KEY.test(key)) return this.legacy.removeItem(key);
    return this.serialize(key, async () => {
      await this.legacy.removeItem(key);
      await this.transaction('readwrite', (store) => store.delete(key));
    });
  }
}
