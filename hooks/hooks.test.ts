// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce, useInterval, useAsync, useStorage } from "./hooks.ts";
import { MemoryStorageAdapter, TypedStorage } from "../base/storage/storage.ts";

describe("hooks", () => {
  it("debounces rapid value changes", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ val }: { val: string }) => useDebounce(val, 200), {
      initialProps: { val: "initial" },
    });

    expect(result.current).toBe("initial");

    rerender({ val: "updated" });
    expect(result.current).toBe("initial");

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(result.current).toBe("initial");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe("updated");

    vi.useRealTimers();
  });

  it("executes interval callbacks and pauses when delay is null", () => {
    vi.useFakeTimers();
    const callback = vi.fn();

    const { rerender } = renderHook(
      ({ delay }: { delay: number | null }) => useInterval(callback, delay),
      {
        initialProps: { delay: 100 as number | null },
      }
    );

    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(callback).toHaveBeenCalledTimes(3);

    rerender({ delay: null });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(callback).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("tracks async execution success and failure states", async () => {
    const successOp = vi.fn().mockResolvedValue("success data");
    const { result: okResult } = renderHook(() => useAsync({ fn: successOp, immediate: true }));

    expect(okResult.current.isLoading).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(okResult.current.isLoading).toBe(false);
    expect(okResult.current.data).toBe("success data");
    expect(okResult.current.error).toBeNull();

    const error = new Error("operation failed");
    const failOp = vi.fn().mockRejectedValue(error);
    const { result: errResult } = renderHook(() => useAsync({ fn: failOp, immediate: true }));

    await act(async () => {
      await Promise.resolve();
    });

    expect(errResult.current.isLoading).toBe(false);
    expect(errResult.current.data).toBeNull();
    expect(errResult.current.error).toEqual(error);
  });

  it("synchronizes state with TypedStorage", () => {
    const memoryAdapter = new MemoryStorageAdapter();
    const storage = new TypedStorage({ adapter: memoryAdapter });

    const { result } = renderHook(() =>
      useStorage({ key: "theme", initialValue: "dark", storage })
    );

    expect(result.current[0]).toBe("dark");

    act(() => {
      result.current[1]("light");
    });

    expect(result.current[0]).toBe("light");
    expect(storage.get("theme")).toBe("light");
  });
});
