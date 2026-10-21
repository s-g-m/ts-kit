import { describe, it, expect, vi } from "vitest";
import { AuthManager, decodeJwt, CodeAuthRefreshFailed } from "./auth.ts";
import { MemoryStorageAdapter } from "../base/storage/storage.ts";
import { HttpClient } from "../base/httpcli/httpcli.ts";
import { asAppError, ErrorTypes } from "../base/errs/errs.ts";

describe("auth", () => {
  it("decodes valid JWT payloads and rejects malformed tokens", () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const token = createMockJwt({ sub: "user-123", exp: futureExp, role: "admin" });

    const decoded = decodeJwt<{ sub: string; exp: number; role: string }>(token);
    expect(decoded).toEqual({ sub: "user-123", exp: futureExp, role: "admin" });
    expect(decodeJwt("invalid-jwt")).toBeNull();
    expect(decodeJwt("a.b")).toBeNull();
  });

  it("stores, notifies and clears authentication state", () => {
    const storage = new MemoryStorageAdapter();
    const auth = new AuthManager({ storage });
    const listener = vi.fn();
    const unsubscribe = auth.subscribe(listener);

    expect(auth.isAuthenticated()).toBe(false);

    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    auth.setTokens({
      accessToken: "access-token-123",
      refreshToken: "refresh-token-456",
      expiresAt: futureExp,
    });

    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.getTokens()?.accessToken).toBe("access-token-123");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    auth.clear();
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.getTokens()).toBeNull();
  });

  it("deduplicates concurrent token refresh calls", async () => {
    const storage = new MemoryStorageAdapter();
    const onRefresh = vi.fn().mockImplementation(async (rToken: string) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return {
        accessToken: `new-access-for-${rToken}`,
        refreshToken: `new-refresh-for-${rToken}`,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      };
    });

    const auth = new AuthManager({ storage, onRefresh });
    auth.setTokens({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });

    const [t1, t2, t3] = await Promise.all([
      auth.refreshToken(),
      auth.refreshToken(),
      auth.refreshToken(),
    ]);

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(t1.accessToken).toBe("new-access-for-old-refresh");
    expect(t2.accessToken).toBe("new-access-for-old-refresh");
    expect(t3.accessToken).toBe("new-access-for-old-refresh");
  });

  it("classifies refresh failures and clears stored tokens", async () => {
    const storage = new MemoryStorageAdapter();
    const auth = new AuthManager({
      storage,
      onRefresh: async () => {
        throw new Error("invalid refresh token");
      },
    });
    auth.setTokens({
      accessToken: "expired",
      refreshToken: "bad-refresh",
      expiresAt: Math.floor(Date.now() / 1000) - 10,
    });

    let caught: unknown = null;
    try {
      await auth.refreshToken();
    } catch (err: unknown) {
      caught = err;
    }

    const failure = asAppError(caught);
    expect(failure?.code).toBe(CodeAuthRefreshFailed);
    expect(failure?.type).toBe(ErrorTypes.Unauthorized);
    expect(auth.getTokens()).toBeNull();
  });

  it("attaches Authorization Bearer header to HttpClient", async () => {
    const storage = new MemoryStorageAdapter();
    const auth = new AuthManager({ storage });
    auth.setTokens({
      accessToken: "valid-secret-token",
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });

    const mockFetch: typeof fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: async () => ({ data: "secure-payload" }),
    }) as unknown as typeof fetch;

    const client = new HttpClient({ fetchFn: mockFetch });
    auth.attachToHttpClient(client);

    await client.get("/protected");

    expect(mockFetch).toHaveBeenCalledWith(
      "/protected",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer valid-secret-token",
        }),
      })
    );
  });
});

function createMockJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.signature`;
}
