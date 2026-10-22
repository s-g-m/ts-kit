import { describe, it, expect, vi } from "vitest";
import {
  newClient,
  CodeHttpClientTimeout,
  CodeHttpClientHttpError,
  CodeHttpClientNetworkError,
} from "./httpcli.ts";
import { asAppError, ErrorTypes, type ErrorType } from "../errs/errs.ts";
import { afterEach } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { MetricReader } from "@opentelemetry/sdk-metrics";
import { init, trace, type TelemetryHandle } from "../telemetry/telemetry.ts";

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
    client.useResponseInterceptor(
      (_resp, data) =>
        ({
          ...(data as Record<string, unknown>),
          intercepted: true,
        }) as typeof data
    );

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
    const timeoutFetch: typeof fetch = vi
      .fn()
      .mockImplementation((_url: string, init?: RequestInit) => {
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

function createMockFetch(params: { ok?: boolean; status: number; body?: unknown }): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: params.ok ?? true,
    status: params.status,
    statusText: "Status",
    headers: new Headers({ "content-type": "application/json" }),
    json: async () => params.body ?? {},
    text: async () => JSON.stringify(params.body ?? {}),
  }) as unknown as typeof fetch;
}

class HttpMetricReader extends MetricReader {
  protected async onShutdown() {}
  protected async onForceFlush() {}
}

describe("automatic HTTP telemetry", () => {
  let runtime: TelemetryHandle | undefined;
  afterEach(async () => {
    await runtime?.shutdown();
  });

  const tests = [
    { name: "success", status: 200, code: "HTTP_CLIENT_REQUEST_SUCCESS", success: true },
    { name: "empty response", status: 204, code: "HTTP_CLIENT_REQUEST_SUCCESS", success: true },
    { name: "not found", status: 404, code: CodeHttpClientHttpError, success: false },
    { name: "server failure", status: 500, code: CodeHttpClientHttpError, success: false },
    { name: "network failure", status: 0, code: CodeHttpClientNetworkError, success: false },
    { name: "invalid JSON", status: 200, code: "HTTP_CLIENT_REQUEST_FAILED", success: false },
    {
      name: "request interceptor failure",
      status: 0,
      code: "HTTP_CLIENT_REQUEST_FAILED",
      success: false,
    },
    {
      name: "response interceptor failure",
      status: 200,
      code: "HTTP_CLIENT_REQUEST_FAILED",
      success: false,
    },
  ];
  it.each(tests)("records exactly one result and duration for $name", async (test) => {
    const reader = new HttpMetricReader();
    const exporter = new InMemorySpanExporter();
    runtime = init({ serviceName: "http-test", metricReader: reader, spanExporter: exporter });
    const response = new Response(
      test.status === 204
        ? null
        : test.name === "invalid JSON"
          ? "invalid"
          : JSON.stringify({ secret: "private-body" }),
      { status: test.status || 200, headers: { "Content-Type": "application/json" } }
    );
    const fetchFn: typeof fetch =
      test.name === "network failure"
        ? vi.fn().mockRejectedValue(new Error("private-url"))
        : vi.fn().mockResolvedValue(response);
    const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn });
    if (test.name === "request interceptor failure")
      client.useRequestInterceptor(() => {
        throw new Error("private-interceptor");
      });
    if (test.name === "response interceptor failure")
      client.useResponseInterceptor(() => {
        throw new Error("private-interceptor");
      });
    const request = client.get("/private-url?token=secret");
    if (test.success) await request;
    else await expect(request).rejects.toBeInstanceOf(Error);
    await runtime.forceFlush();
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("httpcli.request");
    expect(spans[0].attributes["http.request.method"]).toBe("GET");
    if (test.status) expect(spans[0].attributes["http.response.status_code"]).toBe(test.status);
    const { resourceMetrics } = await reader.collect();
    const metrics = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
    const counter = metrics.find((metric) => metric.descriptor.name === "operation.count");
    expect(counter?.dataPoints).toHaveLength(1);
    expect(counter?.dataPoints[0]).toMatchObject({
      value: 1,
      attributes: {
        status: test.success ? "success" : "error",
        code: test.code,
      },
    });
    expect(
      metrics.find((metric) => metric.descriptor.name === "operation.duration")?.dataPoints[0].value
    ).toMatchObject({ count: 1 });
    expect(
      JSON.stringify({
        metrics: resourceMetrics,
        attributes: spans[0].attributes,
        events: spans[0].events,
      })
    ).not.toContain("private-");
  });

  it("includes body reading in the duration and preserves explicit parent context", async () => {
    const reader = new HttpMetricReader();
    const exporter = new InMemorySpanExporter();
    runtime = init({
      serviceName: "test",
      metricReader: reader,
      spanExporter: exporter,
      propagationOrigins: [TEST_BASE_URL],
    });
    let finishBody: (value: unknown) => void = () => {};
    const body = new Promise((resolve) => {
      finishBody = resolve;
    });
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => body,
    } as Response);
    const client = newClient({ baseUrl: TEST_BASE_URL, fetchFn });
    const request = trace("parent", (ctx) => client.get("/items", { context: ctx }));
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
    await runtime.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(0);
    finishBody({ ok: true });
    await request;
    await runtime.forceFlush();
    const spans = exporter.getFinishedSpans();
    const child = spans.find((span) => span.name === "httpcli.request");
    const parent = spans.find((span) => span.name === "parent");
    expect(child?.spanContext().traceId).toBe(parent?.spanContext().traceId);
    const headers = new Headers(fetchFn.mock.calls[0][1]?.headers);
    expect(headers.get("traceparent")).toContain(child?.spanContext().traceId);
    await client.get("https://other.example/items");
    expect(new Headers(fetchFn.mock.calls[1][1]?.headers).has("traceparent")).toBe(false);
  });

  it("records a timeout once and keeps the classified error", async () => {
    const reader = new HttpMetricReader();
    runtime = init({
      serviceName: "test",
      metricReader: reader,
      spanExporter: new InMemorySpanExporter(),
    });
    const fetchFn: typeof fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("timeout")));
      });
    await expect(newClient({ fetchFn, timeoutMs: 5 }).get("/slow")).rejects.toMatchObject({
      code: CodeHttpClientTimeout,
      type: "TIMEOUT",
    });
    const { resourceMetrics } = await reader.collect();
    const counter = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "operation.count");
    expect(counter?.dataPoints).toHaveLength(1);
    expect(counter?.dataPoints[0]).toMatchObject({
      value: 1,
      attributes: { code: CodeHttpClientTimeout, type: "TIMEOUT" },
    });
  });
});

it("awaits asynchronous error interceptors without losing errors or duplicating telemetry", async () => {
  const reader = new HttpMetricReader();
  const exporter = new InMemorySpanExporter();
  const runtime = init({ serviceName: "test", metricReader: reader, spanExporter: exporter });
  try {
    const original = new Error("interceptor rejected");
    const client = newClient({ fetchFn: createMockFetch({ ok: false, status: 500 }) });
    client.useErrorInterceptor(async () => {
      await Promise.resolve();
      throw original;
    });
    await expect(client.get("/failure")).rejects.toBe(original);
    await runtime.forceFlush();
    expect(exporter.getFinishedSpans()).toHaveLength(1);
    const { resourceMetrics } = await reader.collect();
    const counter = resourceMetrics.scopeMetrics
      .flatMap((scope) => scope.metrics)
      .find((metric) => metric.descriptor.name === "operation.count");
    expect(counter?.dataPoints[0].value).toBe(1);
  } finally {
    await runtime.shutdown();
  }
});
