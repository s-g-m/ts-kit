export type BindValue = string | number | null;

/** Subset of expo-sqlite's SQLiteDatabase used by device stores, so tests can supply another engine. */
export interface SqliteDatabase {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: BindValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: BindValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: BindValue[]): Promise<T | null>;
  withExclusiveTransactionAsync(task: (txn: SqliteDatabase) => Promise<void>): Promise<void>;
}

/**
 * Opens an expo-sqlite file and its store on first use, so stores can be created before the app renders.
 * A failed opening is retried on the next call.
 */
export function lazyStore<T>(
  name: string,
  open: (db: SqliteDatabase) => Promise<T>,
): () => Promise<T> {
  let opened: Promise<T> | undefined;
  return () => {
    opened ??= import("expo-sqlite")
      .then(({ openDatabaseAsync }) => openDatabaseAsync(name))
      .then(open)
      .catch((err: unknown) => {
        opened = undefined;
        throw err;
      });
    return opened;
  };
}
