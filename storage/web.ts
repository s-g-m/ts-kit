import { MemoryStorageAdapter, type StorageAdapter } from "./storage.ts";

const STORAGE_PROBE_KEY = "__kit_test__";
const STORAGE_PROBE_VALUE = "1";

/** Browser StorageAdapter over window.localStorage with an automatic in-memory fallback. */
export class LocalStorageAdapter implements StorageAdapter {
  private readonly fallback = new MemoryStorageAdapter();

  public getItem(key: string): string | null {
    const storage = this.getBrowserStorage();
    if (!storage) {
      return this.fallback.getItem(key);
    }
    try {
      return storage.getItem(key);
    } catch {
      return this.fallback.getItem(key);
    }
  }

  public setItem(key: string, value: string): void {
    const storage = this.getBrowserStorage();
    if (!storage) {
      this.fallback.setItem(key, value);
      return;
    }
    try {
      storage.setItem(key, value);
    } catch {
      this.fallback.setItem(key, value);
    }
  }

  public removeItem(key: string): void {
    const storage = this.getBrowserStorage();
    if (!storage) {
      this.fallback.removeItem(key);
      return;
    }
    try {
      storage.removeItem(key);
    } catch {
      this.fallback.removeItem(key);
    }
  }

  public clear(): void {
    const storage = this.getBrowserStorage();
    if (!storage) {
      this.fallback.clear();
      return;
    }
    try {
      storage.clear();
    } catch {
      this.fallback.clear();
    }
  }

  private getBrowserStorage(): Storage | null {
    if (typeof window === "undefined" || !window.localStorage) {
      return null;
    }
    try {
      window.localStorage.setItem(STORAGE_PROBE_KEY, STORAGE_PROBE_VALUE);
      window.localStorage.removeItem(STORAGE_PROBE_KEY);
      return window.localStorage;
    } catch {
      return null;
    }
  }
}
