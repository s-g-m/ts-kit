// Package hooks provides lightweight, reusable React hooks agnostic of business domains.

import { useState, useEffect, useRef, useCallback } from "react";
import { defaultStorage, TypedStorage } from "../base/storage/storage.ts";
import type { AppError } from "../base/errs/errs.ts";

/**
 * Delays updating the returned value until delayMs has passed without changes.
 */
export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delayMs]);

  return debouncedValue;
}

/**
 * Invokes the callback repeatedly every delayMs. Pass null to pause.
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delayMs === null) {
      return;
    }

    const id = setInterval(() => {
      savedCallback.current();
    }, delayMs);

    return () => clearInterval(id);
  }, [delayMs]);
}

export interface AsyncState<T> {
  data: T | null;
  error: Error | AppError | null;
  isLoading: boolean;
}

export interface UseAsyncOptions<T> {
  fn: () => Promise<T>;
  immediate?: boolean;
}

/**
 * Executes an async operation and manages loading, data, and error state.
 */
export function useAsync<T>(
  options: UseAsyncOptions<T> | (() => Promise<T>),
  immediate = true
): AsyncState<T> & { execute: () => Promise<T | null> } {
  const asyncFn = typeof options === "function" ? options : options.fn;
  const shouldRunImmediately =
    typeof options === "function" ? immediate : (options.immediate ?? true);

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | AppError | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(shouldRunImmediately);

  const execute = useCallback(async (): Promise<T | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await asyncFn();
      setData(res);
      return res;
    } catch (err: unknown) {
      const wrapped = err instanceof Error ? err : new Error(String(err));
      setError(wrapped);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [asyncFn]);

  useEffect(() => {
    if (shouldRunImmediately) {
      void execute();
    }
  }, [execute, shouldRunImmediately]);

  return { data, error, isLoading, execute };
}

export interface UseStorageOptions<T> {
  key: string;
  initialValue: T;
  storage?: TypedStorage;
}

/**
 * Synchronizes a React state value with persistent or in-memory TypedStorage.
 */
export function useStorage<T>(
  options: UseStorageOptions<T>
): [T, (value: T | ((prev: T) => T)) => void] {
  const { key, initialValue, storage = defaultStorage } = options;

  const [storedValue, setStoredValue] = useState<T>(() => {
    const item = storage.get<T>(key);
    return item !== null ? item : initialValue;
  });

  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev: T) => {
        const next = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        storage.set(key, next);
        return next;
      });
    },
    [key, storage]
  );

  return [storedValue, setValue];
}
