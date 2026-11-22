import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStorageAdapter, TypedStorage } from "./storage.ts";
import { LocalStorageAdapter } from "./web.ts";

const kvStore = vi.hoisted(() => {
  const data = new Map<string, string>();
  return {
    data,
    getItemSync: vi.fn((key: string) => data.get(key) ?? null),
    setItemSync: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItemSync: vi.fn((key: string) => {
      data.delete(key);
    }),
    clearSync: vi.fn(() => {
      data.clear();
    }),
  };
});

vi.mock("expo-sqlite/kv-store", () => ({ default: kvStore }));

const { sqliteStorageAdapter } = await import("./expo.ts");

const TEST_PREFIX = "app";

describe("storage", () => {
  let memoryAdapter: MemoryStorageAdapter;
  let storage: TypedStorage;

  beforeEach(() => {
    memoryAdapter = new MemoryStorageAdapter();
    storage = new TypedStorage({ adapter: memoryAdapter, prefix: TEST_PREFIX });
    kvStore.data.clear();
    vi.clearAllMocks();
  });

  it("stores and retrieves primitive values across types", () => {
    const tests: { name: string; key: string; value: unknown }[] = [
      { name: "string", key: "name", value: "Alice" },
      { name: "number", key: "count", value: 42 },
      { name: "boolean", key: "active", value: true },
      { name: "object", key: "user", value: { id: "u1", roles: ["admin", "operator"] } },
    ];

    for (const tt of tests) {
      storage.set(tt.key, tt.value);
      expect(storage.get(tt.key), tt.name).toEqual(tt.value);
    }
  });

  it("returns fallback or null when key is missing", () => {
    expect(storage.get("unset")).toBeNull();
    expect(storage.get("unset", "default_val")).toBe("default_val");
    expect(storage.get<number>("unset_num", 100)).toBe(100);
  });

  it("applies prefix to underlying storage keys and supports removal and clear", () => {
    storage.set("token", "xyz");
    storage.set("theme", "dark");

    expect(memoryAdapter.getItem(`${TEST_PREFIX}:token`)).toBe("xyz");

    storage.remove("token");
    expect(storage.get("token")).toBeNull();
    expect(storage.get("theme")).toBe("dark");

    storage.clear();
    expect(storage.get("theme")).toBeNull();
  });

  it("falls back to memory in LocalStorageAdapter when window is unavailable", () => {
    const localAdapter = new LocalStorageAdapter();
    localAdapter.setItem("k1", "v1");

    expect(localAdapter.getItem("k1")).toBe("v1");
    localAdapter.removeItem("k1");
    expect(localAdapter.getItem("k1")).toBeNull();
  });

  it("delegates operations in sqliteStorageAdapter to expo-sqlite/kv-store", () => {
    const adapter = sqliteStorageAdapter();
    adapter.setItem("theme", "dark");
    expect(adapter.getItem("theme")).toBe("dark");

    adapter.removeItem("theme");
    expect(adapter.getItem("theme")).toBeNull();

    adapter.setItem("lang", "es");
    adapter.clear();
    expect(adapter.getItem("lang")).toBeNull();
  });
});
