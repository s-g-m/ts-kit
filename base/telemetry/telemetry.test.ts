import { describe, it, expect, vi } from "vitest";
import { Logger, Telemetry, LogLevels, type LogRecord } from "./telemetry.ts";

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
