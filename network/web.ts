import { type NetworkMonitor, useOnline as useMonitorOnline } from "./network.ts";

/** Subscribes to browser online/offline events, starting with navigator.onLine. */
export function subscribeOnline(listener: (online: boolean) => void): () => void {
  if (typeof window === "undefined") {
    listener(true);
    return () => {};
  }

  listener(typeof navigator !== "undefined" ? navigator.onLine : true);
  const onOnline = () => listener(true);
  const onOffline = () => listener(false);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  return () => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
  };
}

const webNetworkMonitor: NetworkMonitor = { subscribeOnline };

/** Browser NetworkMonitor backed by navigator.onLine and window online/offline events. */
export function createWebNetworkMonitor(): NetworkMonitor {
  return webNetworkMonitor;
}

/** Browser connectivity; undefined until the first reading arrives. */
export function useOnline(): boolean | undefined {
  return useMonitorOnline(webNetworkMonitor);
}
