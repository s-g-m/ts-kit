// Package auth provides JWT token lifecycle management, deduplicated refresh and HTTP client integration.

import { newError } from "../base/errs/errs.ts";
import { TypedStorage, type StorageAdapter } from "../base/storage/storage.ts";
import type { HttpClient } from "../base/httpcli/httpcli.ts";

export const CodeAuthInvalidToken = "AUTH_INVALID_TOKEN";
export const CodeAuthRefreshFailed = "AUTH_REFRESH_FAILED";

const DEFAULT_AUTH_PREFIX = "auth";
const DEFAULT_STORAGE_KEY = "tokens";
const DEFAULT_REFRESH_THRESHOLD_SECONDS = 60;
const JWT_PARTS_COUNT = 3;
const MS_PER_SECOND = 1000;

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface AuthConfig {
  storage?: StorageAdapter;
  storageKey?: string;
  refreshThresholdSeconds?: number;
  onRefresh?: (refreshToken: string) => Promise<AuthTokens>;
}

export type AuthListener = (tokens: AuthTokens | null) => void;

export class AuthManager {
  private readonly storage: TypedStorage;
  private readonly storageKey: string;
  private readonly refreshThreshold: number;
  private readonly onRefreshHandler?: (refreshToken: string) => Promise<AuthTokens>;
  private refreshPromise: Promise<AuthTokens> | null = null;
  private readonly listeners = new Set<AuthListener>();

  constructor(config?: AuthConfig) {
    this.storage = new TypedStorage({ adapter: config?.storage, prefix: DEFAULT_AUTH_PREFIX });
    this.storageKey = config?.storageKey ?? DEFAULT_STORAGE_KEY;
    this.refreshThreshold = config?.refreshThresholdSeconds ?? DEFAULT_REFRESH_THRESHOLD_SECONDS;
    this.onRefreshHandler = config?.onRefresh;
  }

  public getTokens(): AuthTokens | null {
    return this.storage.get<AuthTokens>(this.storageKey);
  }

  public setTokens(tokens: AuthTokens | null): void {
    if (tokens) {
      const normalized = { ...tokens };
      if (!normalized.expiresAt && normalized.accessToken) {
        const decoded = decodeJwt(normalized.accessToken);
        if (decoded?.exp) {
          normalized.expiresAt = decoded.exp;
        }
      }
      this.storage.set(this.storageKey, normalized);
      this.notify(normalized);
      return;
    }

    this.storage.remove(this.storageKey);
    this.notify(null);
  }

  public clear(): void {
    this.setTokens(null);
  }

  public isAuthenticated(): boolean {
    const tokens = this.getTokens();
    if (!tokens?.accessToken) {
      return false;
    }
    return !this.isExpired(tokens);
  }

  public isExpired(tokens?: AuthTokens | null): boolean {
    const target = tokens !== undefined ? tokens : this.getTokens();
    if (!target?.expiresAt) {
      return false;
    }
    const now = Math.floor(Date.now() / MS_PER_SECOND);
    return target.expiresAt - now <= this.refreshThreshold;
  }

  public async getValidAccessToken(): Promise<string | null> {
    const tokens = this.getTokens();
    if (!tokens?.accessToken) {
      return null;
    }

    if (!this.isExpired(tokens)) {
      return tokens.accessToken;
    }

    if (!tokens.refreshToken || !this.onRefreshHandler) {
      return tokens.accessToken;
    }

    try {
      const refreshed = await this.refreshToken();
      return refreshed.accessToken;
    } catch {
      return null;
    }
  }

  /**
   * Refreshes the token safely deduplicating concurrent calls.
   */
  public async refreshToken(): Promise<AuthTokens> {
    const tokens = this.getTokens();
    if (!tokens?.refreshToken) {
      throw newError(CodeAuthRefreshFailed, "No refresh token available").unauthorized();
    }

    if (!this.onRefreshHandler) {
      throw newError(CodeAuthRefreshFailed, "No refresh handler configured").internal();
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const refreshTokenValue = tokens.refreshToken;
    const handler = this.onRefreshHandler;

    this.refreshPromise = (async () => {
      try {
        const newTokens = await handler(refreshTokenValue);
        this.setTokens(newTokens);
        return newTokens;
      } catch (err: unknown) {
        this.clear();
        const appErr = newError(CodeAuthRefreshFailed, "Failed to refresh token").unauthorized();
        appErr.wrap(err);
        throw appErr;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  public subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Attaches an auth request interceptor to HttpClient to automatically inject Bearer headers.
   */
  public attachToHttpClient(client: HttpClient): void {
    client.useRequestInterceptor(async (url, init) => {
      const token = await this.getValidAccessToken();
      if (!token) {
        return { url, init };
      }

      const headers = {
        ...((init.headers as Record<string, string>) ?? {}),
        Authorization: `Bearer ${token}`,
      };

      return {
        url,
        init: { ...init, headers },
      };
    });
  }

  private notify(tokens: AuthTokens | null): void {
    for (const listener of this.listeners) {
      try {
        listener(tokens);
      } catch {
        // Listeners must not break auth state transitions
      }
    }
  }
}

/**
 * Decodes standard JWT payload without external dependencies.
 */
export function decodeJwt<T = { exp?: number; sub?: string; [key: string]: unknown }>(
  token: string
): T | null {
  try {
    const parts = token.split(".");
    if (parts.length !== JWT_PARTS_COUNT) {
      return null;
    }

    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const jsonString = decodeBase64(base64);
    if (!jsonString) {
      return null;
    }

    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}

function decodeBase64(base64: string): string | null {
  if (typeof atob !== "undefined") {
    return atob(base64);
  }
  const buf = (
    globalThis as unknown as {
      Buffer?: { from(input: string, encoding: string): { toString(enc: string): string } };
    }
  ).Buffer;
  if (buf) {
    return buf.from(base64, "base64").toString("utf-8");
  }
  return null;
}
