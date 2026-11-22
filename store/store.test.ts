import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorLevels, ErrorTypes, isAppError } from "../base/errs/errs.ts";
import { CodeStoreUnavailable, MemoryCollectionStore } from "./store.ts";
import { createIndexedDBStore } from "./web.ts";

const sqliteMock = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));
vi.mock("expo-sqlite", () => sqliteMock);

const { createSqliteStore } = await import("./expo.ts");

const TEST_DB = "kit-test";
const TEST_COLLECTION = "items";

describe("store", () => {
  beforeEach(() => {
    sqliteMock.openDatabaseAsync.mockReset();
    vi.unstubAllGlobals();
  });

  it("supports put, get, list, delete, and clear in MemoryCollectionStore", async () => {
    const store = new MemoryCollectionStore();
    await store.put(TEST_COLLECTION, "b", { n: 2 });
    await store.put(TEST_COLLECTION, "a", { n: 1 });
    await store.put("other", "x", { n: 9 });

    expect(await store.get<{ n: number }>(TEST_COLLECTION, "a")).toEqual({ n: 1 });
    expect(await store.get(TEST_COLLECTION, "missing")).toBeNull();
    expect(await store.list<{ n: number }>(TEST_COLLECTION)).toEqual([
      { key: "a", value: { n: 1 } },
      { key: "b", value: { n: 2 } },
    ]);

    await store.delete(TEST_COLLECTION, "a");
    expect(await store.get(TEST_COLLECTION, "a")).toBeNull();

    await store.clear(TEST_COLLECTION);
    expect(await store.list(TEST_COLLECTION)).toEqual([]);
    expect(await store.get<{ n: number }>("other", "x")).toEqual({ n: 9 });
  });

  it("opens sqlite store lazily, retries on failure, and performs CRUD", async () => {
    const rows = new Map<string, Map<string, string>>();
    const fakeDb = createFakeSqliteDb(rows);

    sqliteMock.openDatabaseAsync
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue(fakeDb);

    const store = createSqliteStore({ name: TEST_DB });

    let caught: unknown;
    try {
      await store.get(TEST_COLLECTION, "k1");
    } catch (err) {
      caught = err;
    }
    expect(isAppError(caught)).toBe(true);
    if (isAppError(caught)) {
      expect(caught.code).toBe(CodeStoreUnavailable);
      expect(caught.type).toBe(ErrorTypes.ServiceUnavailable);
      expect(caught.level).toBe(ErrorLevels.Error);
    }

    await store.put(TEST_COLLECTION, "k2", { label: "two" });
    await store.put(TEST_COLLECTION, "k1", { label: "one" });

    expect(await store.get<{ label: string }>(TEST_COLLECTION, "k1")).toEqual({ label: "one" });
    expect(await store.list<{ label: string }>(TEST_COLLECTION)).toEqual([
      { key: "k1", value: { label: "one" } },
      { key: "k2", value: { label: "two" } },
    ]);

    await store.delete(TEST_COLLECTION, "k1");
    expect(await store.get(TEST_COLLECTION, "k1")).toBeNull();

    await store.clear(TEST_COLLECTION);
    expect(await store.list(TEST_COLLECTION)).toEqual([]);
    await store.close?.();
    expect(sqliteMock.openDatabaseAsync).toHaveBeenCalledTimes(2);
  });

  it("opens IndexedDB store lazily and performs CRUD", async () => {
    vi.stubGlobal("indexedDB", createFakeIndexedDB());

    const store = createIndexedDBStore({ name: TEST_DB, collections: [TEST_COLLECTION] });
    await store.put(TEST_COLLECTION, "k2", { label: "two" });
    await store.put(TEST_COLLECTION, "k1", { label: "one" });

    expect(await store.get<{ label: string }>(TEST_COLLECTION, "k1")).toEqual({ label: "one" });
    expect(await store.get(TEST_COLLECTION, "missing")).toBeNull();
    expect(await store.list<{ label: string }>(TEST_COLLECTION)).toEqual([
      { key: "k1", value: { label: "one" } },
      { key: "k2", value: { label: "two" } },
    ]);

    await store.delete(TEST_COLLECTION, "k1");
    expect(await store.get(TEST_COLLECTION, "k1")).toBeNull();

    await store.clear(TEST_COLLECTION);
    expect(await store.list(TEST_COLLECTION)).toEqual([]);
    await store.close?.();
  });

  it("rejects with STORE_UNAVAILABLE when indexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);

    const store = createIndexedDBStore({ name: TEST_DB, collections: [TEST_COLLECTION] });
    let caught: unknown;
    try {
      await store.get(TEST_COLLECTION, "k1");
    } catch (err) {
      caught = err;
    }

    expect(isAppError(caught)).toBe(true);
    if (isAppError(caught)) {
      expect(caught.code).toBe(CodeStoreUnavailable);
      expect(caught.type).toBe(ErrorTypes.ServiceUnavailable);
    }
  });
});

function createFakeSqliteDb(rows: Map<string, Map<string, string>>) {
  return {
    execAsync: vi.fn(async () => {}),
    runAsync: vi.fn(async (sql: string, params: (string | number | null)[]) => {
      const collection = String(params[0]);
      if (sql.startsWith("INSERT")) {
        let bucket = rows.get(collection);
        if (!bucket) {
          bucket = new Map<string, string>();
          rows.set(collection, bucket);
        }
        bucket.set(String(params[1]), String(params[2]));
      } else if (sql.includes("AND key = ?")) {
        rows.get(collection)?.delete(String(params[1]));
      } else if (sql.startsWith("DELETE")) {
        rows.get(collection)?.clear();
      }
    }),
    getFirstAsync: vi.fn(async (_sql: string, params: (string | number | null)[]) => {
      const value = rows.get(String(params[0]))?.get(String(params[1]));
      return value === undefined ? null : { key: String(params[1]), value };
    }),
    getAllAsync: vi.fn(async (_sql: string, params: (string | number | null)[]) => {
      const bucket = rows.get(String(params[0]));
      if (!bucket) {
        return [];
      }
      return Array.from(bucket.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => ({ key, value }));
    }),
    closeAsync: vi.fn(async () => {}),
  };
}

function createFakeIndexedDB() {
  const stores = new Map<string, Map<string, unknown>>();

  function makeRequest<T>(executor: () => T): IDBRequest<T> {
    const req = {
      result: undefined as T,
      error: null,
      onsuccess: null,
      onerror: null,
    } as unknown as IDBRequest<T>;
    queueMicrotask(() => {
      (req as { result: T }).result = executor();
      req.onsuccess?.(new Event("success"));
    });
    return req;
  }

  function makeObjectStore(name: string): IDBObjectStore {
    const data = stores.get(name) ?? new Map<string, unknown>();
    return {
      get: (key: IDBValidKey) => makeRequest(() => data.get(String(key))),
      put: (value: unknown, key?: IDBValidKey) =>
        makeRequest(() => {
          data.set(String(key), value);
          return key as IDBValidKey;
        }),
      delete: (key: IDBValidKey) =>
        makeRequest(() => {
          data.delete(String(key));
        }),
      clear: () =>
        makeRequest(() => {
          data.clear();
        }),
      openCursor: () => {
        const entries = Array.from(data.entries()).sort(([a], [b]) => a.localeCompare(b));
        let index = 0;
        const req = {
          result: null,
          error: null,
          onsuccess: null,
          onerror: null,
        } as unknown as IDBRequest<IDBCursorWithValue | null>;
        const advance = () => {
          queueMicrotask(() => {
            if (index >= entries.length) {
              (req as { result: IDBCursorWithValue | null }).result = null;
            } else {
              const [key, value] = entries[index++];
              (req as { result: IDBCursorWithValue | null }).result = {
                key,
                value,
                continue: advance,
              } as unknown as IDBCursorWithValue;
            }
            req.onsuccess?.(new Event("success"));
          });
        };
        advance();
        return req;
      },
    } as unknown as IDBObjectStore;
  }

  return {
    open: () => {
      const db = {
        objectStoreNames: { contains: (name: string) => stores.has(name) },
        createObjectStore: (name: string) => {
          stores.set(name, new Map<string, unknown>());
          return makeObjectStore(name);
        },
        transaction: (name: string) => ({ objectStore: () => makeObjectStore(name) }),
        close: vi.fn(),
      } as unknown as IDBDatabase;

      const req = {
        result: db,
        error: null,
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      } as unknown as IDBOpenDBRequest;

      queueMicrotask(() => {
        req.onupgradeneeded?.(new Event("upgradeneeded") as IDBVersionChangeEvent);
        req.onsuccess?.(new Event("success"));
      });
      return req;
    },
  };
}
