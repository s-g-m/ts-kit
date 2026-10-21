import { describe, it, expect, vi } from "vitest";
import {
  newClient,
  CodeHttpClientTimeout,
  CodeHttpClientHttpError,
  CodeHttpClientNetworkError,
} from "./httpcli.ts";
import { asAppError, ErrorTypes, type ErrorType } from "../errs/errs.ts";

const TEST_BASE_URL = "https://api.test.com";

describe("httpcli", () => {
  it("executes GET requests with query parameters and normalized baseUrl", async () => {
    const mockFetch = createMockFetch({
      status: 200,
      body: { id: 1, name: "Test" },
    });

    const client = newClient({ baseUrl: `${TEST_BASE_URL}/`, fetchFn: mockFetch });
    const got = await client.get<{ id: number; name: string }>("/users", {
      query: { active: true, page: 2, empty: undefined },
    });

    expect(got).toEqual({ id: 1, name: "Test" });
    expect(client.getBaseUrl()).toBe(TEST_BASE_URL);
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/users?active=true&page=2`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Accept: "application/json" }),
      })
    );
  });

  it("serializes JSON bodies for mutating methods", async () => {
    const mockFetch = createMockFetch({
      status: 201,
      body: { created: true },
    });

    const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn: mockFetch });
    const got = await client.post("/items", { name: "NewItem" });

    expect(got).toEqual({ created: true });
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/items`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "NewItem" }),
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      })
    );
  });

  it("handles 204 No Content responses", async () => {
    const mockFetch = createMockFetch({ status: 204 });

    const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn: mockFetch });
    const got = await client.delete("/items/1");

    expect(got).toEqual({});
  });

  it("maps non-2xx HTTP statuses to classified AppErrors", async () => {
    const tests: {
      name: string;
      status: number;
      body: Record<string, unknown>;
      wantType: ErrorType;
      wantMessage: string;
    }[] = [
      {
        name: "400 Bad Request",
        status: 400,
        body: { error: "Bad input" },
        wantType: ErrorTypes.BadRequest,
        wantMessage: "Bad input",
      },
      {
        name: "401 Unauthorized",
        status: 401,
        body: { message: "Token expired" },
        wantType: ErrorTypes.Unauthorized,
        wantMessage: "Token expired",
      },
      {
        name: "404 Not Found",
        status: 404,
        body: { error: "Item not found" },
        wantType: ErrorTypes.NotFound,
        wantMessage: "Item not found",
      },
      {
        name: "409 Conflict",
        status: 409,
        body: { error: "Ticket is closed" },
        wantType: ErrorTypes.Conflict,
        wantMessage: "Ticket is closed",
      },
      {
        name: "503 Service Unavailable",
        status: 503,
        body: { error: "Maintenance" },
        wantType: ErrorTypes.ServiceUnavailable,
        wantMessage: "Maintenance",
      },
    ];

    for (const tt of tests) {
      const mockFetch = createMockFetch({
        ok: false,
        status: tt.status,
        body: tt.body,
      });
      const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn: mockFetch });

      let caught: unknown = null;
      try {
        await client.get("/resource");
      } catch (err: unknown) {
        caught = err;
      }

      const failure = asAppError(caught);
      expect(failure, tt.name).not.toBeNull();
      expect(failure?.code, tt.name).toBe(CodeHttpClientHttpError);
      expect(failure?.type, tt.name).toBe(tt.wantType);
      expect(failure?.message, tt.name).toBe(tt.wantMessage);
      expect(failure?.details, tt.name).toEqual(tt.body);
    }
  });

  it("applies request and response interceptors in order", async () => {
    const mockFetch = createMockFetch({
      status: 200,
      body: { raw: "data" },
    });

    const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn: mockFetch });
    client.useRequestInterceptor((url, init) => ({
      url,
      init: {
        ...init,
        headers: {
          ...((init.headers as Record<string, string>) ?? {}),
          Authorization: "Bearer test-token",
        },
      },
    }));
    client.useResponseInterceptor((_resp, data) => ({
      ...(data as Record<string, unknown>),
      intercepted: true,
    }) as typeof data);

    const got = await client.get<Record<string, unknown>>("/test");

    expect(got).toEqual({ raw: "data", intercepted: true });
    expect(mockFetch).toHaveBeenCalledWith(
      `${TEST_BASE_URL}/test`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      })
    );
  });

  it("classifies network failures and request timeouts", async () => {
    const timeoutFetch: typeof fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const timeoutClient = newClient({ fetchFn: timeoutFetch, timeoutMs: 20 });
    let timeoutCaught: unknown = null;
    try {
      await timeoutClient.get("/slow");
    } catch (err: unknown) {
      timeoutCaught = err;
    }

    const timeoutErr = asAppError(timeoutCaught);
    expect(timeoutErr?.code).toBe(CodeHttpClientTimeout);
    expect(timeoutErr?.type).toBe(ErrorTypes.Timeout);

    const networkFetch: typeof fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const networkClient = newClient({ fetchFn: networkFetch });
    let networkCaught: unknown = null;
    try {
      await networkClient.get("/offline");
    } catch (err: unknown) {
      networkCaught = err;
    }

    const networkErr = asAppError(networkCaught);
    expect(networkErr?.code).toBe(CodeHttpClientNetworkError);
    expect(networkErr?.type).toBe(ErrorTypes.Internal);
  });
});

function createMockFetch(params: {
  ok?: boolean;
  status: number;
  body?: unknown;
}): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: params.ok ?? true,
    status: params.status,
    statusText: "Status",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => params.body ?? {},
    text: async () => JSON.stringify(params.body ?? {}),
  }) as unknown as typeof fetch;
}
