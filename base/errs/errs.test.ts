import { describe, it, expect } from "vitest";
import {
  newError,
  ErrorTypes,
  ErrorLevels,
  asAppError,
  isAppError,
  withDetails,
  type ErrorType,
  type ErrorLevel,
} from "./errs.ts";

const TEST_CODE = "INVALID_INPUT";
const TEST_MESSAGE = "invalid input";
const TEST_CAUSE_MESSAGE = "root network failure";

describe("errs", () => {
  it("creates a default internal error with error severity", () => {
    const failure = newError(TEST_CODE, TEST_MESSAGE);

    expect(failure.type).toBe(ErrorTypes.Internal);
    expect(failure.level).toBe(ErrorLevels.Error);
    expect(failure.code).toBe(TEST_CODE);
    expect(failure.message).toBe(TEST_MESSAGE);
    expect(failure.messageFormatted()).toBe(`[INTERNAL:${TEST_CODE}] ${TEST_MESSAGE}`);
    expect(failure.toString()).toBe(`[INTERNAL:${TEST_CODE}] ${TEST_MESSAGE}`);
    expect(failure.unwrap()).toBeUndefined();
  });

  it("supports fluent classification methods", () => {
    const tests: {
      name: string;
      apply: (err: ReturnType<typeof newError>) => ReturnType<typeof newError>;
      wantType: ErrorType;
      wantLevel: ErrorLevel;
    }[] = [
      {
        name: "validation warn",
        apply: (err) => err.validation().warn(),
        wantType: ErrorTypes.Validation,
        wantLevel: ErrorLevels.Warn,
      },
      {
        name: "bad request info",
        apply: (err) => err.badRequest().info(),
        wantType: ErrorTypes.BadRequest,
        wantLevel: ErrorLevels.Info,
      },
      {
        name: "unauthorized critical",
        apply: (err) => err.unauthorized().critical(),
        wantType: ErrorTypes.Unauthorized,
        wantLevel: ErrorLevels.Critical,
      },
      {
        name: "forbidden default level",
        apply: (err) => err.forbidden(),
        wantType: ErrorTypes.Forbidden,
        wantLevel: ErrorLevels.Error,
      },
      {
        name: "not found",
        apply: (err) => err.notFound(),
        wantType: ErrorTypes.NotFound,
        wantLevel: ErrorLevels.Error,
      },
      {
        name: "conflict",
        apply: (err) => err.conflict(),
        wantType: ErrorTypes.Conflict,
        wantLevel: ErrorLevels.Error,
      },
      {
        name: "timeout",
        apply: (err) => err.timeout(),
        wantType: ErrorTypes.Timeout,
        wantLevel: ErrorLevels.Error,
      },
      {
        name: "service unavailable",
        apply: (err) => err.serviceUnavailable(),
        wantType: ErrorTypes.ServiceUnavailable,
        wantLevel: ErrorLevels.Error,
      },
      {
        name: "ok and internal",
        apply: (err) => err.internal().ok(),
        wantType: ErrorTypes.OK,
        wantLevel: ErrorLevels.Error,
      },
    ];

    for (const tt of tests) {
      const failure = newError(TEST_CODE, TEST_MESSAGE);
      const got = tt.apply(failure);

      expect(got, tt.name).toBe(failure);
      expect(failure.type, tt.name).toBe(tt.wantType);
      expect(failure.level, tt.name).toBe(tt.wantLevel);
    }
  });

  it("wraps a cause and preserves the cause chain", () => {
    const cause = new Error(TEST_CAUSE_MESSAGE);
    const failure = newError(TEST_CODE, TEST_MESSAGE).validation().warn();

    const got = failure.wrap(cause);

    expect(got).toBe(failure);
    expect(got?.unwrap()).toBe(cause);
    expect(got?.messageFormatted()).toBe(
      `[VALIDATION:${TEST_CODE}] ${TEST_MESSAGE}: ${TEST_CAUSE_MESSAGE}`
    );
  });

  it("returns null when wrap receives null or undefined", () => {
    const failure = newError(TEST_CODE, TEST_MESSAGE);

    expect(failure.wrap(null)).toBeNull();
    expect(failure.wrap(undefined)).toBeNull();
  });

  it("auto-classifies timeout causes as TIMEOUT when wrapping", () => {
    const tests = [
      { name: "TimeoutError", errorName: "TimeoutError" },
      { name: "AbortError", errorName: "AbortError" },
    ];

    for (const tt of tests) {
      const cause = new Error("aborted");
      cause.name = tt.errorName;
      const failure = newError(TEST_CODE, TEST_MESSAGE).validation().warn();

      failure.wrap(cause);

      expect(failure.type, tt.name).toBe(ErrorTypes.Timeout);
      expect(failure.level, tt.name).toBe(ErrorLevels.Warn);
    }
  });

  it("attaches and replaces details without mutating caller objects", () => {
    const details = { field: "email", reason: "malformed" };
    const failure = newError(TEST_CODE, TEST_MESSAGE);

    expect(withDetails(failure, details)).toBe(failure);
    expect(failure.details).toEqual({ field: "email", reason: "malformed" });

    details.field = "mutated";
    expect(failure.details?.field).toBe("email");

    withDetails(failure, null);
    expect(failure.details).toBeUndefined();
  });

  it("resolves asAppError and isAppError across error types", () => {
    const appErr = newError(TEST_CODE, TEST_MESSAGE);
    const plainErr = new Error("plain");

    expect(isAppError(appErr)).toBe(true);
    expect(isAppError(plainErr)).toBe(false);
    expect(isAppError(null)).toBe(false);

    expect(asAppError(appErr)).toBe(appErr);
    expect(asAppError(plainErr)).toBeNull();
    expect(asAppError(undefined)).toBeNull();
    expect(withDetails(plainErr, { id: 1 })).toBe(plainErr);
  });

  it("serializes error state to JSON", () => {
    const failure = newError(TEST_CODE, TEST_MESSAGE)
      .validation()
      .warn()
      .withDetails({ field: "subject" });
    failure.wrap("invalid value");

    expect(failure.toJSON()).toEqual({
      type: ErrorTypes.Validation,
      level: ErrorLevels.Warn,
      code: TEST_CODE,
      message: TEST_MESSAGE,
      cause: "invalid value",
      details: { field: "subject" },
    });
  });
});
