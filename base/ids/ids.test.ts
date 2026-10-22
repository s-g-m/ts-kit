import { describe, expect, it } from "vitest";
import { uuidv7 } from "./ids.ts";

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_TIMESTAMP = 0x0193a3f0a1b2;
const TEST_COUNT = 1000;

describe("ids", () => {
  it("encodes version 7, the RFC variant and the timestamp prefix", () => {
    const id = uuidv7(TEST_TIMESTAMP);
    expect(id).toMatch(UUID_V7_PATTERN);
    expect(id.startsWith("0193a3f0-a1b2-7")).toBe(true);
  });

  it("generates distinct ids", () => {
    expect(new Set(Array.from({ length: TEST_COUNT }, () => uuidv7())).size).toBe(TEST_COUNT);
  });
});
