// Package telemetry provides structured logging, event tracking and decoupled telemetry sinks.

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export const LogLevels = {
  Debug: "DEBUG" as LogLevel,
  Info: "INFO" as LogLevel,
  Warn: "WARN" as LogLevel,
  Error: "ERROR" as LogLevel,
} as const;

export interface LogRecord {
  level: LogLevel;
  namespace?: string;
  message: string;
  context?: Record<string, unknown>;
  timestamp: string;
  error?: unknown;
}

export interface TelemetryEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp: string;
}

export interface TelemetryMetric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: string;
}

export type LogSink = (record: LogRecord) => void;
export type EventSink = (event: TelemetryEvent) => void;
export type MetricSink = (metric: TelemetryMetric) => void;

export interface LoggerOptions {
  namespace?: string;
  minLevel?: LogLevel;
  sinks?: LogSink[];
  context?: Record<string, unknown>;
}

export interface TelemetryConfig {
  minLevel?: LogLevel;
  logSinks?: LogSink[];
  eventSinks?: EventSink[];
  metricSinks?: MetricSink[];
  globalContext?: Record<string, unknown>;
}

interface EmitParams {
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  error?: unknown;
}

const LEVEL_WEIGHTS: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

export class Logger {
  private readonly namespace?: string;
  private minLevel: LogLevel;
  private readonly logSinks: LogSink[];
  private readonly context: Record<string, unknown>;

  constructor(options?: LoggerOptions) {
    this.namespace = options?.namespace;
    this.minLevel = options?.minLevel ?? LogLevels.Info;
    this.logSinks = options?.sinks ? [...options.sinks] : [defaultConsoleSink];
    this.context = { ...(options?.context ?? {}) };
  }

  public withContext(context: Record<string, unknown>): Logger {
    return new Logger({
      namespace: this.namespace,
      minLevel: this.minLevel,
      sinks: this.logSinks,
      context: { ...this.context, ...context },
    });
  }

  public withNamespace(namespace: string): Logger {
    return new Logger({
      namespace,
      minLevel: this.minLevel,
      sinks: this.logSinks,
      context: this.context,
    });
  }

  public addSink(sink: LogSink): void {
    this.logSinks.push(sink);
  }

  public setMinLevel(level: LogLevel): void {
    this.minLevel = level;
  }

  public debug(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: LogLevels.Debug, message, context });
  }

  public info(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: LogLevels.Info, message, context });
  }

  public warn(message: string, context?: Record<string, unknown>): void {
    this.emit({ level: LogLevels.Warn, message, context });
  }

  public error(message: string, error?: unknown, context?: Record<string, unknown>): void {
    this.emit({ level: LogLevels.Error, message, context, error });
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_WEIGHTS[level] >= LEVEL_WEIGHTS[this.minLevel];
  }

  private emit(params: EmitParams): void {
    if (!this.shouldLog(params.level)) {
      return;
    }

    const record: LogRecord = {
      level: params.level,
      namespace: this.namespace,
      message: params.message,
      context: { ...this.context, ...(params.context ?? {}) },
      timestamp: new Date().toISOString(),
      error: params.error,
    };

    for (const sink of this.logSinks) {
      try {
        sink(record);
      } catch {
        // Telemetry sinks must never crash the caller
      }
    }
  }
}

export const defaultConsoleSink: LogSink = (record: LogRecord) => {
  const prefix = record.namespace ? `[${record.namespace}]` : "";
  const out = `${record.timestamp} ${record.level} ${prefix} ${record.message}`.trim();
  const hasCtx = Boolean(record.context && Object.keys(record.context).length > 0);

  if (record.level === "ERROR") {
    console.error(out, record.error ?? "", hasCtx ? record.context : "");
    return;
  }

  const methods: Record<"DEBUG" | "INFO" | "WARN", typeof console.info> = {
    DEBUG: console.debug,
    INFO: console.info,
    WARN: console.warn,
  };
  const fn = methods[record.level];
  if (hasCtx) {
    fn(out, record.context);
  } else {
    fn(out);
  }
};

export class Telemetry {
  private readonly eventSinks: EventSink[];
  private readonly metricSinks: MetricSink[];
  public readonly logger: Logger;

  constructor(config?: TelemetryConfig) {
    this.logger = new Logger({
      minLevel: config?.minLevel,
      sinks: config?.logSinks,
      context: config?.globalContext,
    });
    this.eventSinks = config?.eventSinks ? [...config.eventSinks] : [];
    this.metricSinks = config?.metricSinks ? [...config.metricSinks] : [];
  }

  public addEventSink(sink: EventSink): void {
    this.eventSinks.push(sink);
  }

  public addMetricSink(sink: MetricSink): void {
    this.metricSinks.push(sink);
  }

  public trackEvent(name: string, properties?: Record<string, unknown>): void {
    const event: TelemetryEvent = {
      name,
      properties: properties ? { ...properties } : undefined,
      timestamp: new Date().toISOString(),
    };

    for (const sink of this.eventSinks) {
      try {
        sink(event);
      } catch {
        // Sinks must never fail caller
      }
    }
  }

  public trackMetric(name: string, value: number, tags?: Record<string, string>): void {
    const metric: TelemetryMetric = {
      name,
      value,
      tags: tags ? { ...tags } : undefined,
      timestamp: new Date().toISOString(),
    };

    for (const sink of this.metricSinks) {
      try {
        sink(metric);
      } catch {
        // Sinks must never fail caller
      }
    }
  }
}

export const defaultTelemetry = new Telemetry();

export { init, success, failure, fromError, measure, trace, tracer, recordError } from "./otel.ts";
export type { InitOptions, TelemetryHandle } from "./otel.ts";
