// Package env provides typed environment parsing without service-specific settings.

import { newError } from "../errs/errs.ts";

export const CodeEnvInvalidInteger = "ENV_INVALID_INTEGER";
export const CodeEnvInvalidBoolean = "ENV_INVALID_BOOLEAN";
export const CodeEnvInvalidUrl = "ENV_INVALID_URL";
export const CodeEnvMissingRequired = "ENV_MISSING_REQUIRED";

export type EnvSource = Record<string, string | undefined>;

const TRUTHY_VALUES = new Set(["true", "1", "t"]);
const FALSY_VALUES = new Set(["false", "0", "f"]);

let globalEnvSource: EnvSource | null = null;

/**
 * Configures a custom environment variable dictionary (e.g. from Vite import.meta.env or Expo).
 */
export function setEnvSource(source: EnvSource | null): void {
  globalEnvSource = source;
}

function readWindowEnv(key: string): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const win = window as unknown as { __ENV__?: EnvSource };
  if (win.__ENV__ && key in win.__ENV__) {
    return win.__ENV__[key];
  }
  return undefined;
}

function readProcessEnv(key: string): string | undefined {
  const proc = (globalThis as unknown as { process?: { env?: EnvSource } }).process;
  if (proc?.env && key in proc.env) {
    return proc.env[key];
  }
  return undefined;
}

function resolveEnvValue(key: string, customSource?: EnvSource): string | undefined {
  if (customSource && key in customSource) {
    return customSource[key];
  }
  if (globalEnvSource && key in globalEnvSource) {
    return globalEnvSource[key];
  }
  const procVal = readProcessEnv(key);
  if (procVal !== undefined) {
    return procVal;
  }
  return readWindowEnv(key);
}

/**
 * Reads a string, using fallback when the variable is unset or empty.
 */
export function string(key: string, fallback = "", source?: EnvSource): string {
  const value = resolveEnvValue(key, source);
  if (value === undefined || value === "") {
    return fallback;
  }
  return value;
}

/**
 * Reads an integer, using fallback when unset or empty.
 * Throws AppError(VALIDATION, WARN) if the value is not a valid integer.
 */
export function int(key: string, fallback: number, source?: EnvSource): number {
  const value = resolveEnvValue(key, source);
  if (value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw newError(CodeEnvInvalidInteger, `${key} must be an integer`).validation().warn();
  }

  return parsed;
}

/**
 * Reads a boolean, using fallback when unset or empty.
 * Accepts "true", "1", "t" as true and "false", "0", "f" as false (case-insensitive).
 * Throws AppError(VALIDATION, WARN) if not a recognizable boolean.
 */
export function bool(key: string, fallback: boolean, source?: EnvSource): boolean {
  const value = resolveEnvValue(key, source);
  if (value === undefined || value === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUTHY_VALUES.has(normalized)) {
    return true;
  }
  if (FALSY_VALUES.has(normalized)) {
    return false;
  }

  throw newError(CodeEnvInvalidBoolean, `${key} must be a boolean`).validation().warn();
}

/**
 * Reads a valid URL string, using fallback when unset or empty.
 * Throws AppError(VALIDATION, WARN) if present but not a valid URL.
 */
export function url(key: string, fallback = "", source?: EnvSource): string {
  const value = resolveEnvValue(key, source);
  if (value === undefined || value === "") {
    return fallback;
  }

  try {
    new URL(value);
    return value;
  } catch {
    throw newError(CodeEnvInvalidUrl, `${key} must be a valid URL`).validation().warn();
  }
}

/**
 * Ensures a variable is present and non-empty, throwing an AppError(VALIDATION, WARN) otherwise.
 */
export function required(key: string, source?: EnvSource): string {
  const value = resolveEnvValue(key, source);
  if (value === undefined || value.trim() === "") {
    throw newError(CodeEnvMissingRequired, `${key} is required`).validation().warn();
  }
  return value;
}
