import '@react-native-firebase/app';
import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import { logHandledError } from './errors';

// Bound the local Firestore (LevelDB) persistence cache so it evicts via LRU
// well before it can pressure device storage. Without this the SDK defaults to
// a ~100MB cache; pinning a smaller ceiling is defensive insurance against the
// fatal `LevelDbTransaction::Commit()` assertion that fires when a disk write
// fails — the same guard the provider app already runs. Must be set before the
// first Firestore operation.
firestore().settings({ cacheSizeBytes: 50 * 1024 * 1024 }); // 50 MB

export const db = firestore();
export { auth };
export const getFunctionsInstance = () => functions();

// E2E / local testing only: point the SDKs at the Firebase emulator when
// EXPO_PUBLIC_USE_EMULATOR=1 (set for a dev/simulator build). Strictly a no-op in
// production, where the env var is unset. Host defaults to localhost (iOS
// simulator); Android emulators use 10.0.2.2 via EXPO_PUBLIC_EMULATOR_HOST.
if (process.env.EXPO_PUBLIC_USE_EMULATOR === '1') {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST || 'localhost';
  try {
    firestore().useEmulator(host, 8080);
    auth().useEmulator(`http://${host}:9099`);
    functions().useEmulator(host, 5001);
    if (__DEV__) console.log(`[firebase] Using local emulator at ${host}`);
  } catch (e) {
    console.warn('[firebase] emulator wiring failed:', e);
  }
}

// iOS phone auth needs "app verification" (silent APNs push or a reCAPTCHA
// redirect) before sending an SMS. GoogleService-Info.plist now ships a
// REVERSED_CLIENT_ID and @react-native-firebase/app registers it as a URL scheme,
// so the reCAPTCHA fallback works even where there's no APNs (Simulator) — real
// phone numbers verify normally on both simulator and device.
//
// We deliberately do NOT force appVerificationDisabledForTesting in __DEV__ any
// more: that setting makes Firebase skip verification and accept ONLY whitelisted
// test numbers, so a developer's real number came back as auth/internal-error.
// Opt into test-number mode explicitly (no SMS, fixed codes from the console) via
// EXPO_PUBLIC_DISABLE_APP_VERIFICATION=1 when you actually need it.
if (__DEV__ && process.env.EXPO_PUBLIC_DISABLE_APP_VERIFICATION === '1') {
  auth().settings.appVerificationDisabledForTesting = true;
}

/**
 * Auth state change listener helper
 */
export const onAuthStateChanged = (callback: (user: FirebaseAuthTypes.User | null) => void) => {
  return auth().onAuthStateChanged(callback);
};

/**
 * Global Config Loader and Updater for Admin Hub
 */
export const subscribeToGlobalConfig = (callback: (config: any) => void) => {
  return db.collection('apiConfig').doc('global').onSnapshot(
    (snapshot) => {
      if (snapshot.exists) { callback(snapshot.data()); }
    },
    (err) => { console.warn('subscribeToGlobalConfig error:', err); },
  );
};

/**
 * Functions Instance Helper
 */

/**
 * Saves the FCM token to the user's Firestore document.
 * Mirrors the provider app's saveProviderFcmToken: logs success/failure and
 * retries transient blips, so a token write is observable (it previously failed
 * silently — no log, no retry — which made the customer token look like it never
 * saved even though the provider one did).
 */
export const saveFcmToken = async (phoneNumber: string, fcmToken: string) => {
  if (!phoneNumber) {
    console.warn('saveFcmToken: missing phoneNumber; skipping token save.');
    return;
  }
  try {
    // The push-registration effect fires on onAuthStateChanged, which resolves
    // the instant sign-in succeeds — before the native Firestore layer has the
    // refreshed auth token / phone_number claim (the same ~1s propagation window
    // AuthScreen guards with getIdTokenResult(true) + delay). Force-refresh the
    // token so the claim is present before we write. Best-effort: a failure here
    // (e.g. offline) must not abort the save — the retry below still covers it.
    try {
      await auth().currentUser?.getIdToken(true);
    } catch {
      /* best-effort token refresh */
    }
    // Use the full E.164 phone number (e.g. "+14026061003") as the document ID
    // so it matches the user document created at sign-in (AuthScreen) and the
    // phone_number claim enforced by the Firestore security rules.
    // merge-set (not update): the push-token effect can run before the user doc
    // exists (FCM registers right after sign-in, before onboarding creates it), so
    // update() would fail not-found. The users rule is doc-id based, so a merge
    // keyed by the E.164 id is allowed and self-heals a missing doc.
    // Retry permission-denied too: right after sign-in it means the auth token
    // hasn't reached Firestore yet, not a real denial, so a backoff retry lands
    // once the claim propagates.
    await runWithRetry(
      () => db.collection('users').doc(phoneNumber).set({ fcmToken }, { merge: true }),
      5,
      (e) =>
        isTransient(e) ||
        String(e?.code || '').toLowerCase().includes('permission-denied'),
    );
    // Dev-only, and without the phone number — this logs in production otherwise
    // and would leak PII into device/crash logs.
    if (__DEV__) console.log('Customer FCM token saved');
  } catch (error) {
    // Scope carries no phone number — see the note above on keeping PII out of logs.
    logHandledError('fcm:save-token', error);
  }
};

// Transient connectivity blips (weak signal, a brief network drop) surface as
// 'unavailable' / 'deadline-exceeded' style failures. Retry the operation a few
// times with exponential backoff so a momentary signal dip doesn't fail the
// whole flow before giving up.
const isTransient = (e: any): boolean => {
  const code = String(e?.code || '').toLowerCase();
  const msg = String(e?.message || '').toLowerCase();
  return ['unavailable', 'deadline-exceeded', 'cancelled', 'internal', 'network'].some(
    (t) => code.includes(t) || msg.includes(t),
  );
};

// Force the native Firestore client to drop and re-establish its gRPC streams
// without wiping the local cache. A wedged stream (common after rapid
// sign-out/sign-in cycles, where streams stay bound to a stale auth token)
// returns a *persistent* `firestore/unavailable` that no amount of plain
// retrying clears. Toggling the network reconnects the streams cleanly and is
// safe with active listeners (they briefly serve from cache, then resync).
export const resetFirestoreConnection = async (): Promise<void> => {
  try {
    await db.disableNetwork();
    await db.enableNetwork();
  } catch (e: any) {
    console.warn('resetFirestoreConnection failed:', e?.message || e);
  }
};

export const runWithRetry = async <T>(
  op: () => Promise<T>,
  tries = 4,
  // Which errors are worth retrying. Defaults to transient network/backend
  // blips; callers can widen it (e.g. the FCM-token save also retries
  // permission-denied, which right after sign-in means the auth token hasn't
  // propagated to Firestore yet rather than a real rule violation).
  retryable: (e: any) => boolean = isTransient,
): Promise<T> => {
  let lastError: any;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      if (attempt === tries - 1 || !retryable(e)) throw e;
      // Before the final attempt, hard-reset the connection — by now a plain
      // backoff has failed twice, which points at a wedged stream rather than a
      // momentary dip. This self-heals the persistent-`unavailable` case so the
      // user never sees the error.
      if (attempt === tries - 2) await resetFirestoreConnection();
      // 600ms, 1.2s, 2.4s between attempts.
      await new Promise((res) => setTimeout(res, 600 * 2 ** attempt));
    }
  }
  throw lastError;
};

// Sign out AND reset the native Firestore client, so the next sign-in starts
// with fresh gRPC streams and clean persistence instead of reusing the wedged
// state that produces a persistent `firestore/unavailable` after sign-out/in
// cycling. Always route sign-out through this — never call auth().signOut()
// directly. The teardown is best-effort: a failure here must not strand the
// user signed-in, and the auth state has already flipped by then.
export const signOutClean = async (): Promise<void> => {
  await auth().signOut();
  try {
    // Order matters: terminate() stops the client and closes streams;
    // clearPersistence() then wipes the on-disk cache (only allowed while the
    // client is stopped). RN Firebase re-inits a fresh native client on the
    // next Firestore call, so the exported `db` stays usable afterward.
    await db.terminate();
    await db.clearPersistence();
  } catch (e: any) {
    console.warn('signOutClean: firestore teardown skipped:', e?.message || e);
  }
};

// Helper to generate a unique order ID
export const generateOrderId = () => {
  const timestamp = new Date().getTime();
  const random = Math.random().toString(36).substring(2, 8);
  return `order_${timestamp}_${random}`;
};
