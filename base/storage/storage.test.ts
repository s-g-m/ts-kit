import { describe, it, expect, beforeEach } from "vitest";
import { MemoryStorageAdapter, LocalStorageAdapter, TypedStorage } from "./storage.ts";

const TEST_PREFIX = "app";

describe("storage", () => {
  let memoryAdapter: MemoryStorageAdapter;
  let storage: TypedStorage;

  beforeEach(() => {
    memoryAdapter = new MemoryStorageAdapter();
    storage = new TypedStorage({ adapter: memoryAdapter, prefix: TEST_PREFIX });
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
});
