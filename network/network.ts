import { useEffect, useState } from "react";

/** Platform-agnostic connectivity monitor. */
export interface NetworkMonitor {
  /** Subscribes to online status changes, delivering the current status immediately when available. */
  subscribeOnline(listener: (online: boolean) => void): () => void;
}

/** In-memory NetworkMonitor for tests and non-browser environments. */
export class MemoryNetworkMonitor implements NetworkMonitor {
  private online: boolean;
  private readonly listeners = new Set<(online: boolean) => void>();

  constructor(initialOnline = true) {
    this.online = initialOnline;
  }

  public setOnline(online: boolean): void {
    this.online = online;
    for (const listener of this.listeners) {
      listener(online);
    }
  }

  public subscribeOnline(listener: (online: boolean) => void): () => void {
    this.listeners.add(listener);
    listener(this.online);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** React hook that tracks connectivity from any NetworkMonitor; undefined until the first reading arrives. */
export function useOnline(monitor: NetworkMonitor): boolean | undefined {
  const [online, setOnline] = useState<boolean>();
  useEffect(() => monitor.subscribeOnline(setOnline), [monitor]);
  return online;
}
