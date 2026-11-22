import { newError } from "../base/errs/errs.ts";
import { CodeStoreUnavailable, type CollectionStore, type StoreRecord } from "./store.ts";

export interface IndexedDBStoreOptions {
  name: string;
  collections: string[];
  version?: number;
}

function storeError(message: string, cause: unknown) {
  const err = newError(CodeStoreUnavailable, message).serviceUnavailable();
  err.wrap(cause);
  return err;
}

function openDatabase(options: IndexedDBStoreOptions): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(storeError("indexedDB is not available", null));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(options.name, options.version ?? 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const collection of options.collections) {
        if (!db.objectStoreNames.contains(collection)) {
          db.createObjectStore(collection);
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storeError("failed to open indexedDB", request.error));
  });
}

function runRequest<T>(request: IDBRequest<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storeError(message, request.error));
  });
}

function listStore<T>(objectStore: IDBObjectStore): Promise<StoreRecord<T>[]> {
  return new Promise((resolve, reject) => {
    const records: StoreRecord<T>[] = [];
    const cursorRequest = objectStore.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      records.push({ key: String(cursor.key), value: cursor.value as T });
      cursor.continue();
    };
    cursorRequest.onerror = () => reject(storeError("failed to list records", cursorRequest.error));
  });
}

/**
 * Browser CollectionStore backed by IndexedDB.
 * Opens lazily on first operation and retries if opening fails.
 */
export function createIndexedDBStore(options: IndexedDBStoreOptions): CollectionStore {
  let opened: Promise<IDBDatabase> | undefined;

  const getDB = (): Promise<IDBDatabase> => {
    opened ??= openDatabase(options).catch((err: unknown) => {
      opened = undefined;
      throw err;
    });
    return opened;
  };

  const getObjectStore = async (
    collection: string,
    mode: IDBTransactionMode,
  ): Promise<IDBObjectStore> => {
    const db = await getDB();
    return db.transaction(collection, mode).objectStore(collection);
  };

  return {
    async get<T>(collection: string, key: string): Promise<T | null> {
      const store = await getObjectStore(collection, "readonly");
      const result = await runRequest(store.get(key), "failed to read record");
      return result === undefined ? null : (result as T);
    },
    async put<T>(collection: string, key: string, value: T): Promise<void> {
      const store = await getObjectStore(collection, "readwrite");
      await runRequest(store.put(value, key), "failed to write record");
    },
    async delete(collection: string, key: string): Promise<void> {
      const store = await getObjectStore(collection, "readwrite");
      await runRequest(store.delete(key), "failed to delete record");
    },
    async list<T>(collection: string): Promise<StoreRecord<T>[]> {
      const store = await getObjectStore(collection, "readonly");
      return listStore<T>(store);
    },
    async clear(collection: string): Promise<void> {
      const store = await getObjectStore(collection, "readwrite");
      await runRequest(store.clear(), "failed to clear collection");
    },
    async close(): Promise<void> {
      if (!opened) {
        return;
      }
      const db = await opened;
      opened = undefined;
      db.close();
    },
  };
}
