// Package storage provides platform-agnostic, typed key-value storage contracts and adapters.

const STORAGE_PROBE_KEY = "__kit_test__";
const STORAGE_PROBE_VALUE = "1";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
}

export interface TypedStorageOptions {
  adapter?: StorageAdapter;
  prefix?: string;
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>();

  public getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  public setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  public removeItem(key: string): void {
    this.store.delete(key);
  }

  public clear(): void {
    this.store.clear();
  }
}

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

export class TypedStorage {
  private readonly adapter: StorageAdapter;
  private readonly prefix: string;

  constructor(options?: TypedStorageOptions) {
    this.adapter =
      options?.adapter ??
      (typeof window !== "undefined" ? new LocalStorageAdapter() : new MemoryStorageAdapter());
    this.prefix = options?.prefix ? `${options.prefix}:` : "";
  }

  public get<T>(key: string, fallback: T): T;
  public get<T>(key: string): T | null;
  public get<T>(key: string, fallback?: T): T | null {
    const raw = this.adapter.getItem(this.buildKey(key));
    if (raw === null || raw === undefined) {
      return fallback !== undefined ? fallback : null;
    }

    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as unknown as T;
    }
  }

  public set<T>(key: string, value: T): void {
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    this.adapter.setItem(this.buildKey(key), serialized);
  }

  public remove(key: string): void {
    this.adapter.removeItem(this.buildKey(key));
  }

  public clear(): void {
    this.adapter.clear();
  }

  private buildKey(key: string): string {
    return `${this.prefix}${key}`;
  }
}

export const defaultStorage = new TypedStorage();
