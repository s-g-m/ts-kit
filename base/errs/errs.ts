// Package errs classifies errors while preserving their causes.

export type ErrorType =
  | "OK"
  | "BAD_REQUEST"
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "TIMEOUT"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL";

export type ErrorLevel = "INFO" | "WARN" | "ERROR" | "CRITICAL";

export const ErrorTypes = {
  OK: "OK" as ErrorType,
  BadRequest: "BAD_REQUEST" as ErrorType,
  Validation: "VALIDATION" as ErrorType,
  Unauthorized: "UNAUTHORIZED" as ErrorType,
  Forbidden: "FORBIDDEN" as ErrorType,
  NotFound: "NOT_FOUND" as ErrorType,
  Conflict: "CONFLICT" as ErrorType,
  Timeout: "TIMEOUT" as ErrorType,
  ServiceUnavailable: "SERVICE_UNAVAILABLE" as ErrorType,
  Internal: "INTERNAL" as ErrorType,
} as const;

export const ErrorLevels = {
  Info: "INFO" as ErrorLevel,
  Warn: "WARN" as ErrorLevel,
  Error: "ERROR" as ErrorLevel,
  Critical: "CRITICAL" as ErrorLevel,
} as const;

const ERROR_NAME_APP = "AppError";
const ERROR_NAME_TIMEOUT = "TimeoutError";
const ERROR_NAME_ABORT = "AbortError";

export class AppError extends Error {
  public type: ErrorType = ErrorTypes.Internal;
  public level: ErrorLevel = ErrorLevels.Error;
  public readonly code: string;
  public details?: Record<string, unknown>;
  public override cause?: unknown;

  constructor(code: string, message: string) {
    super(message);
    this.name = ERROR_NAME_APP;
    this.code = code;
  }

  public withType(errType: ErrorType): this {
    this.type = errType;
    return this;
  }

  public withLevel(level: ErrorLevel): this {
    this.level = level;
    return this;
  }

  public ok(): this {
    return this.withType(ErrorTypes.OK);
  }

  public badRequest(): this {
    return this.withType(ErrorTypes.BadRequest);
  }

  public validation(): this {
    return this.withType(ErrorTypes.Validation);
  }

  public unauthorized(): this {
    return this.withType(ErrorTypes.Unauthorized);
  }

  public forbidden(): this {
    return this.withType(ErrorTypes.Forbidden);
  }

  public notFound(): this {
    return this.withType(ErrorTypes.NotFound);
  }

  public conflict(): this {
    return this.withType(ErrorTypes.Conflict);
  }

  public timeout(): this {
    return this.withType(ErrorTypes.Timeout);
  }

  public serviceUnavailable(): this {
    return this.withType(ErrorTypes.ServiceUnavailable);
  }

  public internal(): this {
    return this.withType(ErrorTypes.Internal);
  }

  public info(): this {
    return this.withLevel(ErrorLevels.Info);
  }

  public warn(): this {
    return this.withLevel(ErrorLevels.Warn);
  }

  public critical(): this {
    return this.withLevel(ErrorLevels.Critical);
  }

  public withDetails(details: Record<string, unknown> | null): this {
    this.details = details ? { ...details } : undefined;
    return this;
  }

  /**
   * Wrap attaches a non-null cause and ends the chain, or returns null when cause is null/undefined.
   * DOMException timeouts and AbortSignals override category with TIMEOUT.
   */
  public wrap(cause: unknown): this | null {
    if (cause == null) {
      return null;
    }

    if (isTimeoutCause(cause)) {
      this.type = ErrorTypes.Timeout;
    }

    this.cause = cause;
    return this;
  }

  public unwrap(): unknown {
    return this.cause;
  }

  public override toString(): string {
    return this.messageFormatted();
  }

  public messageFormatted(): string {
    const causeMsg = formatCause(this.cause);
    if (causeMsg) {
      return `[${this.type}:${this.code}] ${this.message}: ${causeMsg}`;
    }
    return `[${this.type}:${this.code}] ${this.message}`;
  }

  public toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      level: this.level,
      code: this.code,
      message: this.message,
      cause: formatCause(this.cause),
      details: this.details,
    };
  }
}

function isTimeoutErrorName(name: string): boolean {
  return name === ERROR_NAME_TIMEOUT || name === ERROR_NAME_ABORT;
}

function isTimeoutCause(cause: unknown): boolean {
  if (!cause) {
    return false;
  }
  if (cause instanceof Error && isTimeoutErrorName(cause.name)) {
    return true;
  }
  if (typeof DOMException !== "undefined" && cause instanceof DOMException) {
    return isTimeoutErrorName(cause.name);
  }
  return false;
}

function formatCause(cause: unknown): string | undefined {
  if (cause == null) {
    return undefined;
  }
  if (cause instanceof AppError) {
    return cause.messageFormatted();
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/**
 * Factory function mirroring Go's errs.New(code, message).
 */
export function newError(code: string, message: string): AppError {
  return new AppError(code, message);
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function asAppError(err: unknown): AppError | null {
  if (err instanceof AppError) {
    return err;
  }
  return null;
}

export function withDetails<T>(err: T, details: Record<string, unknown> | null): T {
  if (isAppError(err)) {
    err.withDetails(details);
  }
  return err;
}
