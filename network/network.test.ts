// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryNetworkMonitor, useOnline } from "./network.ts";
import { createWebNetworkMonitor, useOnline as useWebOnline } from "./web.ts";

type Listener = (state: { isConnected: boolean; isInternetReachable?: boolean }) => void;

const expoNetwork = vi.hoisted(() => ({ listener: undefined as Listener | undefined }));

vi.mock("expo-network", () => ({
  getNetworkStateAsync: async () => ({ isConnected: false, isInternetReachable: false }),
  addNetworkStateListener: (listener: Listener) => {
    expoNetwork.listener = listener;
    return { remove: () => (expoNetwork.listener = undefined) };
  },
}));

const { isOnline, useOnline: useExpoOnline } = await import("./expo.ts");

describe("network", () => {
  it("tracks connectivity through MemoryNetworkMonitor and useOnline", () => {
    const monitor = new MemoryNetworkMonitor(false);
    const { result } = renderHook(() => useOnline(monitor));

    expect(result.current).toBe(false);
    act(() => monitor.setOnline(true));
    expect(result.current).toBe(true);
  });

  it("tracks browser online and offline events in web adapter", () => {
    const monitor = createWebNetworkMonitor();
    const states: boolean[] = [];
    const unsubscribe = monitor.subscribeOnline((online) => states.push(online));

    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    unsubscribe();
    window.dispatchEvent(new Event("offline"));

    expect(states.slice(-2)).toEqual([false, true]);

    const { result } = renderHook(() => useWebOnline());
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });

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

  it.each(tests)("classifies expo connectivity: $name", (test) => {
    expect(isOnline(test.state)).toBe(test.online);
  });

  it("follows expo connectivity changes and unsubscribes on unmount", async () => {
    const { result, unmount } = renderHook(() => useExpoOnline());
    await vi.waitFor(() => expect(result.current).toBe(false));

    act(() => expoNetwork.listener?.({ isConnected: true, isInternetReachable: true }));
    expect(result.current).toBe(true);

    unmount();
    expect(expoNetwork.listener).toBeUndefined();
  });
});
