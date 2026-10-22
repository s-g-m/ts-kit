import { beforeEach, describe, expect, it } from "vitest";
import { asAppError, ErrorLevels, ErrorTypes } from "../errs/errs.ts";
import {
  bool,
  CodeEnvInvalidBoolean,
  CodeEnvInvalidInteger,
  CodeEnvInvalidUrl,
  CodeEnvMissingRequired,
  type EnvSource,
  int,
  required,
  resolveHostUrl,
  setEnvSource,
  string,
  url,
} from "./env.ts";

const TEST_VARIABLE = "TEST_ENV_VALUE";
const CASE_VALID = "valid value";
const CASE_EMPTY = "empty value uses fallback";
const CASE_UNSET = "unset variable uses fallback";
const CASE_INVALID = "invalid value";

interface ReadCase<T> {
  name: string;
  value?: string;
  unset?: boolean;
  want?: T;
  wantCode?: string;
}

describe("env", () => {
  beforeEach(() => {
    setEnvSource(null);
  });

  it("reads string values and fallbacks", () => {
    const fallback = "default";
    const tests: ReadCase<string>[] = [
      { name: CASE_VALID, value: "custom-value", want: "custom-value" },
      { name: CASE_EMPTY, value: "", want: fallback },
      { name: CASE_UNSET, unset: true, want: fallback },
    ];

    runReadTests(tests, (source) => string(TEST_VARIABLE, fallback, source));
  });

  it("reads integer values and rejects invalid numbers", () => {
    const fallback = 3000;
    const tests: ReadCase<number>[] = [
      { name: CASE_VALID, value: "8080", want: 8080 },
      { name: "zero integer", value: "0", want: 0 },
      { name: "negative integer", value: "-42", want: -42 },
      { name: CASE_EMPTY, value: "", want: fallback },
      { name: CASE_UNSET, unset: true, want: fallback },
      { name: CASE_INVALID, value: "not-a-number", wantCode: CodeEnvInvalidInteger },
      { name: "float rejected", value: "12.34", wantCode: CodeEnvInvalidInteger },
    ];

    runReadTests(tests, (source) => int(TEST_VARIABLE, fallback, source));
  });

  it("reads boolean values and rejects invalid booleans", () => {
    const fallback = true;
    const tests: ReadCase<boolean>[] = [
      { name: "true literal", value: "true", want: true },
      { name: "numeric one", value: "1", want: true },
      { name: "short true", value: "T", want: true },
      { name: "false literal", value: "false", want: false },
      { name: "numeric zero", value: "0", want: false },
      { name: "short false", value: "F", want: false },
      { name: CASE_EMPTY, value: "", want: fallback },
      { name: CASE_UNSET, unset: true, want: fallback },
      { name: CASE_INVALID, value: "yes", wantCode: CodeEnvInvalidBoolean },
    ];

    runReadTests(tests, (source) => bool(TEST_VARIABLE, fallback, source));
  });

  it("reads URL values and rejects malformed URLs", () => {
    const fallback = "http://localhost:3000";
    const tests: ReadCase<string>[] = [
      {
        name: CASE_VALID,
        value: "https://api.example.com/v1",
        want: "https://api.example.com/v1",
      },
      { name: CASE_EMPTY, value: "", want: fallback },
      { name: CASE_UNSET, unset: true, want: fallback },
      { name: CASE_INVALID, value: "not_a_valid_url", wantCode: CodeEnvInvalidUrl },
    ];

    runReadTests(tests, (source) => url(TEST_VARIABLE, fallback, source));
  });

  it("validates required variables", () => {
    const tests: ReadCase<string>[] = [
      { name: CASE_VALID, value: "secret-xyz", want: "secret-xyz" },
      { name: CASE_EMPTY, value: "   ", wantCode: CodeEnvMissingRequired },
      { name: CASE_UNSET, unset: true, wantCode: CodeEnvMissingRequired },
    ];

    runReadTests(tests, (source) => required(TEST_VARIABLE, source));
  });

  it("uses global environment source when custom source is omitted", () => {
    setEnvSource({ [TEST_VARIABLE]: "global_value" });

    expect(string(TEST_VARIABLE, "default")).toBe("global_value");
  });
});

function runReadTests<T>(tests: ReadCase<T>[], reader: (source: EnvSource) => T): void {
  for (const tt of tests) {
    const source: EnvSource = tt.unset ? {} : { [TEST_VARIABLE]: tt.value };

    if (!tt.wantCode) {
      const got = reader(source);
      expect(got, tt.name).toBe(tt.want);
      continue;
    }

    let caught: unknown = null;
    try {
      reader(source);
    } catch (err: unknown) {
      caught = err;
    }

    const failure = asAppError(caught);
    expect(failure, tt.name).not.toBeNull();
    expect(failure?.code, tt.name).toBe(tt.wantCode);
    expect(failure?.type, tt.name).toBe(ErrorTypes.Validation);
    expect(failure?.level, tt.name).toBe(ErrorLevels.Warn);
    expect(failure?.message, tt.name).toContain(TEST_VARIABLE);
  }
}

describe("resolveHostUrl", () => {
  const hostTests = [
    {
      name: "localhost on android",
      value: "http://localhost:8080",
      os: "android",
      expected: "http://10.0.2.2:8080",
    },
    {
      name: "loopback ip on android",
      value: "http://127.0.0.1:9099",
      os: "android",
      expected: "http://10.0.2.2:9099",
    },
    {
      name: "localhost on ios",
      value: "http://localhost:8080",
      os: "ios",
      expected: "http://localhost:8080",
    },
    {
      name: "remote host on android",
      value: "https://api.example.com",
      os: "android",
      expected: "https://api.example.com",
    },
  ];
  it.each(hostTests)("$name", (test) => {
    expect(resolveHostUrl(test.value, test.os)).toBe(test.expected);
  });
});
