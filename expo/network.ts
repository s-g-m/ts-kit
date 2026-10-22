import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from "expo-network";
import { useEffect, useState } from "react";

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

/** Device connectivity; undefined until the first reading arrives. */
export function useOnline(): boolean | undefined {
  const [online, setOnline] = useState<boolean>();
  useEffect(() => subscribeOnline(setOnline), []);
  return online;
}
