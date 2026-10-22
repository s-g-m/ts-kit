// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (state: { isConnected: boolean; isInternetReachable?: boolean }) => void;

const network = vi.hoisted(() => ({ listener: undefined as Listener | undefined }));
const sqlite = vi.hoisted(() => ({ openDatabaseAsync: vi.fn() }));

vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: false, isInternetReachable: false }),
  addNetworkStateListener: (listener: Listener) => {
    network.listener = listener;
    return { remove: () => (network.listener = undefined) };
  },
}));
vi.mock("expo-sqlite", () => sqlite);

const { isOnline, useOnline } = await import("./network.ts");
const { lazyStore } = await import("./sqlite.ts");

const TEST_DATABASE = "test.db";

describe("expo network", () => {
  const tests = [
    {
      name: "connected and reachable",
      state: { isConnected: true, isInternetReachable: true },
      online: true,
    },
    {
      name: "reachability unknown",
      state: { isConnected: true, isInternetReachable: undefined },
      online: true,
    },
    {
      name: "connected without internet",
      state: { isConnected: true, isInternetReachable: false },
      online: false,
    },
    {
      name: "disconnected",
      state: { isConnected: false, isInternetReachable: undefined },
      online: false,
    },
  ];
  it.each(tests)("classifies connectivity: $name", (test) => {
    expect(isOnline(test.state)).toBe(test.online);
  });

  it("follows connectivity changes and unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() => useOnline());
    await vi.waitFor(() => expect(result.current).toBe(false));

    act(() => network.listener?.({ isConnected: true, isInternetReachable: true }));
    expect(result.current).toBe(true);

    unmount();
    expect(network.listener).toBeUndefined();
  });
});

describe("expo sqlite", () => {
  beforeEach(() => sqlite.openDatabaseAsync.mockReset());

  it("opens the database once and retries after a failure", async () => {
    sqlite.openDatabaseAsync
      .mockRejectedValueOnce(new Error("locked"))
      .mockResolvedValue({ name: TEST_DATABASE });
    const open = vi.fn(async (db: unknown) => ({ db }));
    const store = lazyStore(TEST_DATABASE, open);

    await expect(store()).rejects.toThrow("locked");
    const first = await store();
    const second = await store();

    expect(first).toBe(second);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(TEST_DATABASE);
    expect(open).toHaveBeenCalledOnce();
  });
});
