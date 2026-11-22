import { newError } from "../base/errs/errs.ts";
import { CodeStoreUnavailable, type CollectionStore, type StoreRecord } from "./store.ts";

export interface SqliteStoreOptions {
  name: string;
}

interface SqliteRow {
  key: string;
  value: string;
}

interface SqliteHandle {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: (string | number | null)[]): Promise<T | null>;
  closeAsync?(): Promise<void>;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS kit_store (
  collection TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (collection, key)
);
`;

function storeError(message: string, cause: unknown) {
  const err = newError(CodeStoreUnavailable, message).serviceUnavailable();
  err.wrap(cause);
  return err;
}

/**
 * Expo CollectionStore backed by expo-sqlite.
 * Opens lazily on first operation and retries if opening fails.
 */
export function createSqliteStore(options: SqliteStoreOptions): CollectionStore {
  let opened: Promise<SqliteHandle> | undefined;

  const getDB = (): Promise<SqliteHandle> => {
    opened ??= import("expo-sqlite")
      .then(({ openDatabaseAsync }) => openDatabaseAsync(options.name) as Promise<SqliteHandle>)
      .then(async (db) => {
        await db.execAsync(SCHEMA_SQL);
        return db;
      })
      .catch((err: unknown) => {
        opened = undefined;
        throw storeError("failed to open sqlite store", err);
      });
    return opened;
  };

  return {
    async get<T>(collection: string, key: string): Promise<T | null> {
      const db = await getDB();
      const row = await db.getFirstAsync<SqliteRow>(
        "SELECT key, value FROM kit_store WHERE collection = ? AND key = ?",
        [collection, key],
      );
      return row ? (JSON.parse(row.value) as T) : null;
    },
    async put<T>(collection: string, key: string, value: T): Promise<void> {
      const db = await getDB();
      await db.runAsync(
        "INSERT OR REPLACE INTO kit_store (collection, key, value) VALUES (?, ?, ?)",
        [collection, key, JSON.stringify(value)],
      );
    },
    async delete(collection: string, key: string): Promise<void> {
      const db = await getDB();
      await db.runAsync("DELETE FROM kit_store WHERE collection = ? AND key = ?", [
        collection,
        key,
      ]);
    },
    async list<T>(collection: string): Promise<StoreRecord<T>[]> {
      const db = await getDB();
      const rows = await db.getAllAsync<SqliteRow>(
        "SELECT key, value FROM kit_store WHERE collection = ? ORDER BY key ASC",
        [collection],
      );
      return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T }));
    },
    async clear(collection: string): Promise<void> {
      const db = await getDB();
      await db.runAsync("DELETE FROM kit_store WHERE collection = ?", [collection]);
    },
    async close(): Promise<void> {
      if (!opened) {
        return;
      }
      const db = await opened;
      opened = undefined;
      await db.closeAsync?.();
    },
  };
}
