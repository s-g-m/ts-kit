// OpenTelemetry lifecycle and operation helpers shared by browser and native clients.
import {
  context,
  trace as otelTrace,
  ProxyTracerProvider,
  SpanKind,
  SpanStatusCode,
  type Attributes,
  type Context,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  ConsoleMetricExporter,
  type MetricReader,
} from "@opentelemetry/sdk-metrics";
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  ConsoleSpanExporter,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { asAppError, ErrorTypes, type ErrorType } from "../errs/errs.ts";

const SCOPE = "ts-kit";
const noopTracer = new ProxyTracerProvider().getTracer(SCOPE);
const propagator = new W3CTraceContextPropagator();

export interface InitOptions {
  serviceName: string;
  environment?: string;
  serviceVersion?: string;
  disabled?: boolean;
  /** Collector base URL; /v1/metrics and /v1/traces are appended. Omit for console export. */
  endpoint?: string;
  exportIntervalMs?: number;
  /** Exact origins allowed to receive traceparent/tracestate headers. Empty by default. */
  propagationOrigins?: readonly string[];
  /** Standard OpenTelemetry components, useful for embedding and in-memory testing. */
  metricReader?: MetricReader;
  spanExporter?: SpanExporter;
}

export interface TelemetryHandle {
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}

function createRecorder(options: InitOptions) {
  const resource = resourceFromAttributes({
    "service.name": options.serviceName,
    "deployment.environment.name": options.environment ?? "local",
    ...(options.serviceVersion ? { "service.version": options.serviceVersion } : {}),
  });
  const endpoint = options.endpoint?.replace(/\/+$/, "");
  const meterProvider = new MeterProvider({
    resource,
    readers: [
      options.metricReader ??
        new PeriodicExportingMetricReader({
          exporter: endpoint
            ? new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` })
            : new ConsoleMetricExporter(),
          exportIntervalMillis: options.exportIntervalMs ?? 60_000,
          exportTimeoutMillis: Math.min(options.exportIntervalMs ?? 60_000, 10_000),
        }),
    ],
  });
  const tracerProvider = new BasicTracerProvider({
    resource,
    spanProcessors: [
      new BatchSpanProcessor(
        options.spanExporter ??
          (endpoint
            ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
            : new ConsoleSpanExporter())
      ),
    ],
  });
  const meter = meterProvider.getMeter(SCOPE);
  return {
    meterProvider,
    tracerProvider,
    operations: meter.createCounter("operation.count", { unit: "{operation}" }),
    duration: meter.createHistogram("operation.duration", { unit: "s" }),
    propagationOrigins: new Set(options.propagationOrigins ?? []),
  };
}

type Recorder = ReturnType<typeof createRecorder>;
let current: Recorder | undefined;
let handle: TelemetryHandle | undefined;

/** Initializes once. Before init, when disabled, and after shutdown helpers are no-ops. */
export function init(options: InitOptions): TelemetryHandle {
  if (handle) return handle;
  const recorder = options.disabled ? undefined : createRecorder(options);
  current = recorder;
  let shutdownPromise: Promise<void> | undefined;
  const result: TelemetryHandle = {
    async forceFlush() {
      if (!recorder || shutdownPromise) return;
      await Promise.all([
        recorder.meterProvider.forceFlush(),
        recorder.tracerProvider.forceFlush(),
      ]);
    },
    shutdown() {
      shutdownPromise ??= (async () => {
        if (current === recorder) current = undefined;
        try {
          if (recorder)
            await Promise.all([
              recorder.meterProvider.shutdown(),
              recorder.tracerProvider.shutdown(),
            ]);
        } finally {
          if (handle === result) handle = undefined;
        }
      })();
      return shutdownPromise;
    },
  };
  handle = result;
  return result;
}

export function success(code: string): void {
  safe(() => current?.operations.add(1, { status: "success", code }));
}

export function failure(code: string, errorType: ErrorType): void {
  safe(() => current?.operations.add(1, { status: "error", code, type: errorType }));
}

export function fromError(error: unknown): void {
  if (error == null) return;
  const appError = asAppError(error);
  failure(appError?.code ?? "TELEMETRY_OPERATION_FAILED", appError?.type ?? ErrorTypes.Internal);
}

/** Returns an idempotent stop function; duration is recorded in seconds. */
export function measure(operation: string): () => void {
  const recorder = current;
  const started = performance.now();
  let finished = false;
  return () => {
    if (finished) return;
    finished = true;
    safe(() =>
      recorder?.duration.record((performance.now() - started) / 1000, {
        operation,
      })
    );
  };
}

export function tracer(name = SCOPE): Tracer {
  return current?.tracerProvider.getTracer(name) ?? noopTracer;
}

/** Records only classification, never error messages, payloads, URLs or stack traces. */
export function recordError(span: Span, error: unknown): void {
  if (error == null) return;
  const appError = asAppError(error);
  safe(() => {
    span.setAttributes({
      "error.code": appError?.code ?? "TELEMETRY_OPERATION_FAILED",
      "error.type": appError?.type ?? ErrorTypes.Internal,
      "error.level": appError?.level ?? "ERROR",
    });
    span.setStatus({ code: SpanStatusCode.ERROR });
  });
}

/** Explicit context supports async code without relying on a browser-specific context manager. */
export async function trace<T>(
  name: string,
  operation: (ctx: Context) => Promise<T> | T,
  parent = context.active()
): Promise<T> {
  if (!current) return operation(parent);
  const span = tracer().startSpan(name, {}, parent);
  try {
    return await operation(otelTrace.setSpan(parent, span));
  } catch (error) {
    recordError(span, error);
    throw error;
  } finally {
    safe(() => span.end());
  }
}

export interface HttpObservation {
  setStatus(status: number): void;
  headers(url: string, headers?: HeadersInit): HeadersInit | undefined;
}

/** One result, duration and client span per logical request, including response consumption. */
export async function observeHttp<T>(
  method: string,
  operation: (observation: HttpObservation) => Promise<T>,
  parent = context.active()
): Promise<T> {
  const recorder = current;
  if (!recorder) return operation({ setStatus() {}, headers: (_url, headers) => headers });
  const normalizedMethod = method.toUpperCase();
  const attributes: Attributes = {
    "http.request.method": /^(GET|HEAD|POST|PUT|DELETE|CONNECT|OPTIONS|TRACE|PATCH)$/.test(
      normalizedMethod
    )
      ? normalizedMethod
      : "_OTHER",
  };
  const span = recorder.tracerProvider
    .getTracer("httpcli")
    .startSpan("httpcli.request", { kind: SpanKind.CLIENT, attributes }, parent);
  const spanContext = otelTrace.setSpan(parent, span);
  const stop = measure("httpcli.request");
  try {
    const result = await operation({
      setStatus(status) {
        safe(() => span.setAttribute("http.response.status_code", status));
      },
      headers(url, headers) {
        try {
          if (!recorder.propagationOrigins.has(new URL(url).origin)) return headers;
          const merged = new Headers(headers);
          propagator.inject(spanContext, merged, {
            set(carrier, key, value) {
              carrier.set(key, String(value));
            },
          });
          return Object.fromEntries(merged.entries());
        } catch {
          return headers;
        }
      },
    });
    safe(() =>
      recorder.operations.add(1, {
        status: "success",
        code: "HTTP_CLIENT_REQUEST_SUCCESS",
      })
    );
    return result;
  } catch (error) {
    const appError = asAppError(error);
    safe(() =>
      recorder.operations.add(1, {
        status: "error",
        code: appError?.code ?? "HTTP_CLIENT_REQUEST_FAILED",
        type: appError?.type ?? ErrorTypes.Internal,
      })
    );
    recordError(span, error);
    throw error;
  } finally {
    stop();
    safe(() => span.end());
  }
}

function safe(action: () => unknown): void {
  try {
    action();
  } catch {
    /* Telemetry must not break application operations. */
  }
}
