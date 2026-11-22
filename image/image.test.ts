import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorLevels, ErrorTypes, isAppError } from "../base/errs/errs.ts";
import {
  CodeImageUnreadable,
  DEFAULT_IMAGE_LIMITS,
  fitWithin,
  PREPARED_IMAGE_MIME,
} from "./image.ts";

const picker = vi.hoisted(() => ({ launchImageLibraryAsync: vi.fn() }));
const manipulator = vi.hoisted(() => ({ manipulate: vi.fn() }));

vi.mock("expo-image-picker", () => picker);
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: manipulator,
  SaveFormat: { JPEG: "jpeg" },
}));

const { pickImage } = await import("./expo.ts");
const { prepareImage } = await import("./web.ts");

describe("image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps the aspect ratio with the longest side at the limit", () => {
    expect(fitWithin(4000, 3000, 1024)).toEqual({ width: 1024, height: 768 });
    expect(fitWithin(1000, 3000, 256)).toEqual({ width: 85, height: 256 });
  });

  it("never enlarges small images and tolerates empty sizes", () => {
    expect(fitWithin(300, 200, DEFAULT_IMAGE_LIMITS.maxSide)).toEqual({ width: 300, height: 200 });
    expect(fitWithin(0, 0, 256)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(5000, 1, 256)).toEqual({ width: 256, height: 1 });
  });

  it("returns null from pickImage when the user cancels", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    await expect(pickImage()).resolves.toBeNull();
  });

  it("reduces and returns image and thumbnail from pickImage", async () => {
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///photo.png", width: 2048, height: 1024 }],
    });
    manipulator.manipulate.mockReturnValue({
      resize: () => ({
        renderAsync: async () => ({
          saveAsync: async () => ({ uri: "file:///resized.jpg" }),
        }),
      }),
    });
    const fakeBlob = new Blob(["jpg"], { type: PREPARED_IMAGE_MIME });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ blob: async () => fakeBlob })),
    );

    const prepared = await pickImage();
    expect(prepared).toEqual({
      image: fakeBlob,
      thumb: fakeBlob,
      mime: PREPARED_IMAGE_MIME,
      width: 1024,
      height: 512,
    });
  });

  it("throws IMAGE_UNREADABLE from prepareImage when decoding fails", async () => {
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => {
        throw new Error("corrupt");
      }),
    );

    let caught: unknown;
    try {
      await prepareImage(new Blob(["bad"]));
    } catch (err) {
      caught = err;
    }

    expect(isAppError(caught)).toBe(true);
    if (isAppError(caught)) {
      expect(caught.code).toBe(CodeImageUnreadable);
      expect(caught.type).toBe(ErrorTypes.BadRequest);
      expect(caught.level).toBe(ErrorLevels.Error);
    }
  });
});
