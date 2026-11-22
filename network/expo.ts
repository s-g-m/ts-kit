import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { type NetworkMonitor, useOnline as useMonitorOnline } from "./network.ts";

export function isOnline(state: NetworkState): boolean {
  return Boolean(state.isConnected) && state.isInternetReachable !== false;
}

/** Notifies connectivity changes, starting with the current state unless a change arrives first. */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  let changed = false;
  void getNetworkStateAsync().then((state) => changed || listener(isOnline(state)));
  const subscription = addNetworkStateListener((state) => {
    changed = true;
    listener(isOnline(state));
  });
  return () => subscription.remove();
}

const expoNetworkMonitor: NetworkMonitor = { subscribeOnline };

/** Expo NetworkMonitor backed by expo-network. */
export function createExpoNetworkMonitor(): NetworkMonitor {
  return expoNetworkMonitor;
}

/** Device connectivity; undefined until the first reading arrives. */
export function useOnline(): boolean | undefined {
  return useMonitorOnline(expoNetworkMonitor);
}
