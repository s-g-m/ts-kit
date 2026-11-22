// Package store provides a portable asynchronous collection store contract for Web (IndexedDB) and Mobile (SQLite).

export const CodeStoreUnavailable = "STORE_UNAVAILABLE";

export interface StoreRecord<T = unknown> {
  key: string;
  value: T;
}

/** Portable asynchronous key-value store partitioned by logical collection. */
export interface CollectionStore {
  get<T>(collection: string, key: string): Promise<T | null>;
  put<T>(collection: string, key: string, value: T): Promise<void>;
  delete(collection: string, key: string): Promise<void>;
  list<T>(collection: string): Promise<StoreRecord<T>[]>;
  clear(collection: string): Promise<void>;
  close?(): Promise<void>;
}

/** In-memory CollectionStore for tests and non-persistent runtimes. */
export class MemoryCollectionStore implements CollectionStore {
  private readonly collections = new Map<string, Map<string, string>>();

  public async get<T>(collection: string, key: string): Promise<T | null> {
    const raw = this.collections.get(collection)?.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }

  public async put<T>(collection: string, key: string, value: T): Promise<void> {
    let bucket = this.collections.get(collection);
    if (!bucket) {
      bucket = new Map<string, string>();
      this.collections.set(collection, bucket);
    }
    bucket.set(key, JSON.stringify(value));
  }

  public async delete(collection: string, key: string): Promise<void> {
    this.collections.get(collection)?.delete(key);
  }

  public async list<T>(collection: string): Promise<StoreRecord<T>[]> {
    const bucket = this.collections.get(collection);
    if (!bucket) {
      return [];
    }
    return Array.from(bucket.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, raw]) => ({ key, value: JSON.parse(raw) as T }));
  }

  public async clear(collection: string): Promise<void> {
    this.collections.get(collection)?.clear();
  }

  public async close(): Promise<void> {
    this.collections.clear();
  }
}
