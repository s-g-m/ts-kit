import {
  AppleAuthProvider,
  type AuthCredential,
  connectAuthEmulator,
  GoogleAuthProvider,
  getAuth,
  onAuthStateChanged,
  signInWithCredential,
  signOut,
} from "@react-native-firebase/auth";
import {
  type AuthGateway,
  CodeAuthSignInFailed,
  CodeAuthSignInUnavailable,
  type SignInProvider,
} from "../auth/auth.ts";
import { newError } from "../base/errs/errs.ts";

export interface FirebaseNativeSettings {
  /** Firebase Auth emulator URL; empty in deployed environments. */
  emulatorUrl?: string;
}

/** The Auth emulator accepts unsigned provider tokens, so local sign-in needs no Google or Apple setup. */
export function emulatorCredential(provider: SignInProvider): AuthCredential {
  const claims = JSON.stringify({
    sub: `local-${provider}-user`,
    email: `${provider}.user@example.com`,
    email_verified: true,
    name: provider === "google" ? "Usuario Google" : "Usuario Apple",
  });
  return provider === "google"
    ? GoogleAuthProvider.credential(claims)
    : AppleAuthProvider.credential(claims, "");
}

/**
 * Firebase Auth with native persistence: the session stays open until the user signs out.
 * Native Google and Apple sign-in are not integrated yet, so only the Auth emulator can sign in.
 */
export function createFirebaseNativeAuth(settings: FirebaseNativeSettings = {}): AuthGateway {
  const auth = getAuth();
  if (settings.emulatorUrl) {
    connectAuthEmulator(auth, settings.emulatorUrl);
  }

  return {
    onUserChanged: (listener) =>
      onAuthStateChanged(auth, (user) =>
        listener(user ? { uid: user.uid, displayName: user.displayName } : null),
      ),
    signIn: async (provider) => {
      if (!settings.emulatorUrl) {
        throw newError(
          CodeAuthSignInUnavailable,
          "native Google and Apple sign-in are only available with the Auth emulator",
        ).validation();
      }
      try {
        await signInWithCredential(auth, emulatorCredential(provider));
      } catch (err) {
        const appError = newError(CodeAuthSignInFailed, "signing in with Firebase");
        appError.wrap(err);
        throw appError;
      }
    },
    signOut: () => signOut(auth),
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
  };
}
