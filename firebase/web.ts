import { FirebaseError, initializeApp } from "firebase/app";
import {
  browserLocalPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  OAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  type AuthGateway,
  CodeAuthSignInCancelled,
  CodeAuthSignInFailed,
  type SignInProvider,
} from "../auth/auth.ts";
import { type AppError, newError } from "../base/errs/errs.ts";

const APPLE_PROVIDER_ID = "apple.com";
const CANCELLED_CODES = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

export interface FirebaseWebSettings {
  projectId: string;
  apiKey: string;
  authDomain: string;
  /** Firebase Auth emulator URL; empty in deployed environments. */
  emulatorUrl?: string;
}

/** Firebase Auth for the browser: the session persists in IndexedDB until the user signs out. */
export function createFirebaseWebAuth(settings: FirebaseWebSettings): AuthGateway {
  const app = initializeApp({
    apiKey: settings.apiKey,
    authDomain: settings.authDomain,
    projectId: settings.projectId,
  });
  const auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  if (settings.emulatorUrl) {
    connectAuthEmulator(auth, settings.emulatorUrl, { disableWarnings: true });
  }

  return {
    onUserChanged: (listener) =>
      onAuthStateChanged(auth, (user) =>
        listener(user ? { uid: user.uid, displayName: user.displayName } : null),
      ),
    signIn: async (provider: SignInProvider) => {
      try {
        await signInWithPopup(
          auth,
          provider === "google" ? new GoogleAuthProvider() : new OAuthProvider(APPLE_PROVIDER_ID),
        );
      } catch (err) {
        throw webSignInError(err);
      }
    },
    signOut: () => signOut(auth),
    getIdToken: async () => (auth.currentUser ? auth.currentUser.getIdToken() : null),
  };
}

/** Classifies a Firebase sign-in failure; a closed popup is a cancellation, not an error to report. */
export function webSignInError(err: unknown): AppError {
  const cancelled = err instanceof FirebaseError && CANCELLED_CODES.has(err.code);
  const appError = cancelled
    ? newError(CodeAuthSignInCancelled, "sign-in cancelled by the user").warn()
    : newError(CodeAuthSignInFailed, "signing in with Firebase");
  appError.wrap(err);
  return appError;
}
