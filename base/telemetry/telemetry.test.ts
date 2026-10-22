import { describe, it, expect, vi } from "vitest";
import { Logger, Telemetry, LogLevels, type LogRecord } from "./telemetry.ts";
import { afterEach } from "vitest";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { MetricReader, DataPointType } from "@opentelemetry/sdk-metrics";
import {
  init,
  success,
  failure,
  fromError,
  measure,
  trace,
  type TelemetryHandle,
} from "./telemetry.ts";
import { newError } from "../errs/errs.ts";
import { createServer } from "node:http";

describe("telemetry", () => {
  it("filters log records according to minimum severity level", () => {
    const records: LogRecord[] = [];
    const logger = new Logger({
      minLevel: LogLevels.Warn,
      sinks: [(r) => records.push(r)],
    });

    logger.debug("debug message");
    logger.info("info message");
    expect(records).toHaveLength(0);

    logger.warn("warn message");
    expect(records).toHaveLength(1);
    expect(records[0].level).toBe(LogLevels.Warn);

    logger.error("error message", new Error("boom"));
    expect(records).toHaveLength(2);
    expect(records[1].level).toBe(LogLevels.Error);
  });

  it("propagates namespaces and merged context across derived loggers", () => {
    const records: LogRecord[] = [];
    const baseLogger = new Logger({ sinks: [(r) => records.push(r)] });
    const scopedLogger = baseLogger.withNamespace("Auth").withContext({ userId: "u123" });

    scopedLogger.info("User logged in", { ip: "127.0.0.1" });

    expect(records).toHaveLength(1);
    expect(records[0].namespace).toBe("Auth");
    expect(records[0].context).toEqual({
      userId: "u123",
      ip: "127.0.0.1",
    });
  });

  it("isolates sink failures so logging and telemetry never crash the caller", () => {
    const failingLog = () => {
      throw new Error("log sink failure");
    };
    const failingEvent = () => {
      throw new Error("event sink failure");
    };
    const failingMetric = () => {
      throw new Error("metric sink failure");
    };

    const telemetry = new Telemetry({
      logSinks: [failingLog],
      eventSinks: [failingEvent],
      metricSinks: [failingMetric],
    });

    expect(() => telemetry.logger.info("safe log")).not.toThrow();
    expect(() => telemetry.trackEvent("safe_event")).not.toThrow();
    expect(() => telemetry.trackMetric("safe_metric", 1)).not.toThrow();
  });

  it("dispatches events and metrics to registered sinks", () => {
    const eventSink = vi.fn();
    const metricSink = vi.fn();
    const telemetry = new Telemetry();

    telemetry.addEventSink(eventSink);
    telemetry.addMetricSink(metricSink);

    telemetry.trackEvent("button_clicked", { buttonId: "submit" });
    telemetry.trackMetric("page_load_time_ms", 320, { page: "/dashboard" });

    expect(eventSink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "button_clicked",
        properties: { buttonId: "submit" },
      })
    );
    expect(metricSink).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "page_load_time_ms",
        value: 320,
        tags: { page: "/dashboard" },
      })
    );
  });
});

// Verify actual SDK output instead of mocking telemetry calls.

class TestMetricReader extends MetricReader {
  protected async onShutdown() {}
  protected async onForceFlush() {}
}

describe("OpenTelemetry operations", () => {
  let runtime: TelemetryHandle | undefined;
  afterEach(async () => {
    await runtime?.shutdown();
  });

  it("exports classified counters, idempotent durations and service identity", async () => {
    const reader = new TestMetricReader();
    runtime = init({
      serviceName: "test-web",
      environment: "test",
      metricReader: reader,
      spanExporter: new InMemorySpanExporter(),
    });
    expect(init({ serviceName: "ignored" })).toBe(runtime);
    success("SAVED");
    failure("REJECTED", "VALIDATION");
    fromError(null);
    fromError(newError("OFFLINE", "private message").serviceUnavailable());
    fromError(new Error("private message"));
    const stop = measure("work");
    stop();
    stop();
    const { resourceMetrics } = await reader.collect();
    expect(resourceMetrics.resource.attributes["service.name"]).toBe("test-web");
    expect(resourceMetrics.resource.attributes["deployment.environment.name"]).toBe("test");
    const metrics = resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics);
    expect(
      metrics.find((metric) => metric.descriptor.name === "operation.count")?.dataPoints
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 1, attributes: { status: "success", code: "SAVED" } }),
        expect.objectContaining({
          value: 1,
          attributes: { status: "error", code: "REJECTED", type: "VALIDATION" },
        }),
        expect.objectContaining({
          value: 1,
          attributes: { status: "error", code: "OFFLINE", type: "SERVICE_UNAVAILABLE" },
        }),
        expect.objectContaining({
          value: 1,
          attributes: { status: "error", code: "TELEMETRY_OPERATION_FAILED", type: "INTERNAL" },
        }),
      ])
    );
    const duration = metrics.find((metric) => metric.descriptor.name === "operation.duration");
    expect(duration?.descriptor.unit).toBe("s");
    expect(duration?.dataPointType).toBe(DataPointType.HISTOGRAM);
    expect(duration?.dataPoints[0].value).toEqual(expect.objectContaining({ count: 1 }));
    expect(JSON.stringify(resourceMetrics)).not.toContain("private message");
  });

  it("preserves errors and exports sanitized spans", async () => {
    const spans = new InMemorySpanExporter();
    runtime = init({
      serviceName: "test",
      metricReader: new TestMetricReader(),
      spanExporter: spans,
    });
    const error = newError("SAVE_FAILED", "private ticket content").conflict();
    await expect(
      trace("save", () => {
        throw error;
      })
    ).rejects.toBe(error);
    await runtime.forceFlush();
    const [span] = spans.getFinishedSpans();
    expect(span.name).toBe("save");
    expect(span.attributes).toMatchObject({
      "error.code": "SAVE_FAILED",
      "error.type": "CONFLICT",
    });
    expect(span.status.code).toBe(2);
    expect(
      JSON.stringify({ attributes: span.attributes, events: span.events, status: span.status })
    ).not.toContain("private ticket content");
  });

  it("does not export when disabled and permits reinitialization after shutdown", async () => {
    const reader = new TestMetricReader();
    const spans = new InMemorySpanExporter();
    runtime = init({
      serviceName: "disabled",
      disabled: true,
      metricReader: reader,
      spanExporter: spans,
    });
    success("IGNORED");
    measure("ignored")();
    expect(await trace("ignored", () => 42)).toBe(42);
    await runtime.forceFlush();
    expect(spans.getFinishedSpans()).toHaveLength(0);
    const shutdown = runtime.shutdown();
    expect(runtime.shutdown()).toBe(shutdown);
    await shutdown;
    runtime = init({ serviceName: "enabled", metricReader: reader, spanExporter: spans });
    success("RECORDED");
    const { resourceMetrics } = await reader.collect();
    expect(resourceMetrics.scopeMetrics.flatMap((scope) => scope.metrics)).toHaveLength(1);
  });
});

it("exports traces and metrics through OTLP HTTP to a collector endpoint", async () => {
  const received: { url: string; body: Record<string, unknown> }[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      received.push({ url: request.url ?? "", body: JSON.parse(body) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  const runtime = init({ serviceName: "otlp-test", endpoint: `http://127.0.0.1:${address.port}` });
  try {
    success("EXPORTED");
    await trace("export-test", () => 42);
    await runtime.forceFlush();
    expect(received).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          url: "/v1/metrics",
          body: expect.objectContaining({ resourceMetrics: expect.any(Array) }),
        }),
        expect.objectContaining({
          url: "/v1/traces",
          body: expect.objectContaining({ resourceSpans: expect.any(Array) }),
        }),
      ])
    );
    expect(JSON.stringify(received)).toContain("operation.count");
    expect(JSON.stringify(received)).toContain("export-test");
  } finally {
    await runtime.shutdown();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
  }
});
