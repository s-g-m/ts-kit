import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CodeAuthSignInCancelled,
  CodeAuthSignInFailed,
  CodeAuthSignInUnavailable,
} from "../auth/auth.ts";
import { asAppError, ErrorLevels } from "../base/errs/errs.ts";

const nativeAuth = vi.hoisted(() => ({
  signInWithCredential: vi.fn(),
  connectAuthEmulator: vi.fn(),
}));

vi.mock("@react-native-firebase/auth", () => ({
  getAuth: () => ({ currentUser: null }),
  connectAuthEmulator: nativeAuth.connectAuthEmulator,
  onAuthStateChanged: vi.fn(() => () => undefined),
  signInWithCredential: nativeAuth.signInWithCredential,
  signOut: vi.fn(),
  GoogleAuthProvider: { credential: (token: string) => ({ providerId: "google.com", token }) },
  AppleAuthProvider: { credential: (token: string) => ({ providerId: "apple.com", token }) },
}));

const { FirebaseError } = await import("firebase/app");
const { webSignInError } = await import("./web.ts");
const { createFirebaseNativeAuth, emulatorCredential } = await import("./native.ts");

const TEST_EMULATOR_URL = "http://localhost:9099";

describe("firebase web", () => {
  const tests = [
    {
      name: "closed popup",
      err: new FirebaseError("auth/popup-closed-by-user", "x"),
      code: CodeAuthSignInCancelled,
    },
    {
      name: "replaced popup",
      err: new FirebaseError("auth/cancelled-popup-request", "x"),
      code: CodeAuthSignInCancelled,
    },
    {
      name: "other Firebase error",
      err: new FirebaseError("auth/network-request-failed", "x"),
      code: CodeAuthSignInFailed,
    },
    { name: "unknown error", err: new Error("x"), code: CodeAuthSignInFailed },
  ];
  it.each(tests)("classifies sign-in errors: $name", (test) => {
    expect(webSignInError(test.err).code).toBe(test.code);
  });

  it("logs cancellations as warnings", () => {
    expect(webSignInError(new FirebaseError("auth/popup-closed-by-user", "x")).level).toBe(
      ErrorLevels.Warn,
    );
  });
});

describe("firebase native", () => {
  beforeEach(() => {
    nativeAuth.signInWithCredential.mockReset();
    nativeAuth.connectAuthEmulator.mockReset();
  });

  it("signs in through the emulator with unsigned provider tokens", async () => {
    const auth = createFirebaseNativeAuth({ emulatorUrl: TEST_EMULATOR_URL });
    await auth.signIn("apple");

    expect(nativeAuth.connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      TEST_EMULATOR_URL,
    );
    expect(nativeAuth.signInWithCredential).toHaveBeenCalledWith(
      expect.anything(),
      emulatorCredential("apple"),
    );
  });

  it("rejects sign-in without the emulator", async () => {
    const err = await createFirebaseNativeAuth()
      .signIn("google")
      .catch((cause: unknown) => cause);
    expect(asAppError(err)?.code).toBe(CodeAuthSignInUnavailable);
    expect(nativeAuth.signInWithCredential).not.toHaveBeenCalled();
  });

  it("classifies SDK failures", async () => {
    nativeAuth.signInWithCredential.mockRejectedValue(new Error("network"));
    const err = await createFirebaseNativeAuth({ emulatorUrl: TEST_EMULATOR_URL })
      .signIn("google")
      .catch((cause: unknown) => cause);
    expect(asAppError(err)?.code).toBe(CodeAuthSignInFailed);
  });
});
