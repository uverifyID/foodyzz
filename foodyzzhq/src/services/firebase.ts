import auth from '@react-native-firebase/auth';
import firestore from '@react-native-firebase/firestore';
import functions from '@react-native-firebase/functions';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

// Exporting native instances to match existing logic
export { auth };

// Bound the local Firestore (LevelDB) persistence cache so it evicts via LRU
// well before it can pressure device storage. Without this the SDK defaults to
// a ~100MB cache; pinning a smaller ceiling is defensive insurance against the
// fatal `LevelDbTransaction::Commit()` assertion that fires when a disk write
// fails. Must run before the first Firestore operation.
firestore().settings({ cacheSizeBytes: 50 * 1024 * 1024 }); // 50 MB

export const db = firestore();
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
    console.log(`[firebase] Using local emulator at ${host}`);
  } catch (e) {
    console.warn('[firebase] emulator wiring failed:', e);
  }
}

/**
 * Resolve the unique active store document id `${phone}_${zip}`.
 *
 * Multiple provider stores can share a phone number, so a phone-only lookup is
 * ambiguous. The active store's zip is persisted at login under
 * `active_provider_zip`; combined with the authenticated phone it yields the
 * exact provider document. Returns null only before a store has been selected.
 */
export const getActiveProviderId = async (): Promise<string | null> => {
  const user = auth().currentUser;
  const cleanPhone = user?.phoneNumber?.replace(/\D/g, '') || user?.email?.split('@')[0] || '';
  const zip = await ReactNativeAsyncStorage.getItem('active_provider_zip');
  if (!cleanPhone || !zip) return null;
  return `${cleanPhone}_${zip}`;
};

// Helper for Auth changes
export const onAuthStateChanged = (callback: (user: any) => void) => {
  return auth().onAuthStateChanged(callback);
};

/**
 * Pull the staff `admin` custom claim onto this device's ID token.
 *
 * Staff access is claim-driven — Storage rules gate customer identity documents on
 * `request.auth.token.admin`, and rules cannot read Firestore, so there is no other
 * way to express it. The claim is granted server-side from the `staff/{phone}`
 * allowlist by the syncAdminClaim function; this is the client half.
 *
 * A newly-set claim does NOT appear on the token already in memory — Firebase only
 * embeds claims at issue time. Without the forced refresh the device keeps sending
 * a claim-less token for up to an hour and every document read 403s.
 *
 * Runs once per uid: getIdToken(true) itself fires onAuthStateChanged, so an
 * unguarded call from the auth listener would loop. Only a SUCCESSFUL sync latches,
 * so a failure (offline at login) retries on the next auth event.
 *
 * Pass `force` to bypass that latch — needed when the account was added to the
 * staff allowlist AFTER this session signed in, where the latched result is stale
 * by definition and re-checking is the entire point of the call.
 */
let adminClaimSyncedFor: string | null = null;

export const syncAdminClaim = async (force = false): Promise<boolean> => {
  const user = auth().currentUser;
  if (!user) { adminClaimSyncedFor = null; return false; }

  if (!force && adminClaimSyncedFor === user.uid) {
    const res = await user.getIdTokenResult();
    return (res.claims as any)?.admin === true;
  }

  try {
    const res: any = await functions().httpsCallable('syncAdminClaim')({});
    adminClaimSyncedFor = user.uid;
    const shouldBeAdmin = res?.data?.admin === true;

    // Refresh when THIS DEVICE'S TOKEN disagrees with the server, not merely when
    // the server changed something. `changed` describes the auth RECORD; it is
    // false whenever the record was already correct — including the common case
    // where the account was enrolled while this device held a token minted just
    // before the grant. Keying the refresh off `changed` alone left that device
    // sending a claim-less token until it expired on its own (~1h), which reads as
    // "no access — staff permissions" long after enrolment succeeded.
    const tokenHasAdmin = ((await user.getIdTokenResult()).claims as any)?.admin === true;
    if (force || res?.data?.changed || tokenHasAdmin !== shouldBeAdmin) {
      await user.getIdToken(true);
    }

    if (__DEV__) console.log('[auth] admin claim =', res?.data?.admin);
    return shouldBeAdmin;
  } catch (e: any) {
    console.warn('[auth] admin claim sync failed:', e?.message || e);
    return false;
  }
};

/**
 * Global Config Loader
 */
export const subscribeToGlobalConfig = (callback: (config: any) => void) => {
  return firestore().collection('apiConfig').doc('global').onSnapshot((snapshot) => {
    if (snapshot && snapshot.exists) { callback(snapshot.data()); }
  }, (error) => {
    console.error('Error fetching global config:', error);
  });
};

export const updateGlobalConfig = (newConfig: Partial<any>) =>
  firestore().collection('apiConfig').doc('global').update(newConfig);

// Function to save provider's FCM token
export const saveProviderFcmToken = async (phoneNumber: string, token: string, zipCode?: string) => {
  try {
    // Prefer the keyed doc for the active store, but only update it if it exists.
    // Updating a non-existent providers/${phone}_${zip} doc fails the hardened
    // rule (no existing phoneNumber for ownsPhoneField to check) and surfaces as
    // permission-denied — so fall back to the by-phone lookup of an owned doc.
    // Always write phoneNumber (digits) alongside the token via merge-set. The
    // hardened providers rule checks ownsPhoneField(request.resource.data.phoneNumber)
    // — i.e. the POST-write doc must carry the caller's own digits-phone. A bare
    // update({ fcmToken }) relies on the existing doc already having a correct
    // phoneNumber field; legacy/wizard-created docs that omit it would be denied.
    // Including phoneNumber here satisfies the rule unconditionally and self-heals.
    if (zipCode) {
      const ref = firestore().collection('providers').doc(`${phoneNumber}_${zipCode}`);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.set({ fcmToken: token, phoneNumber }, { merge: true });
        // Dev-only, and without the phone number (PII) in the log line.
        if (__DEV__) console.log('Provider FCM token saved (keyed doc)');
        return;
      }
    }

    const snap = await firestore().collection('providers').where('phoneNumber', '==', phoneNumber).get();
    if (!snap.empty) {
      await snap.docs[0].ref.set({ fcmToken: token, phoneNumber }, { merge: true });
      // Dev-only, and without the phone number (PII) in the log line.
      if (__DEV__) console.log('Provider FCM token saved via phone lookup');
    } else {
      if (__DEV__) console.log('No provider doc found; skipping FCM token save.');
    }
  } catch (error) {
    console.error('Error saving provider FCM token:', error);
  }
};

// Helper to get a promo document reference. Scoped by the provider's unique doc
// id (`${phone}_${storeIdentifier}`), NOT the service zip — two stores of the same
// owner can share a zip, and the service zip is no longer the doc-key suffix.
export const getPromoDoc = (providerId: string, promoId: string) => {
  return firestore().collection('promos').doc(`${providerId}_${promoId}`);
};

// Transient connectivity blips (weak signal, a brief network drop) surface as
// 'unavailable' / 'deadline-exceeded' style failures. Retry the operation a few
// times with exponential backoff so a momentary signal dip doesn't fail the
// whole flow before giving up.
export const isTransient = (e: any): boolean => {
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

export const runWithRetry = async <T>(op: () => Promise<T>, tries = 4): Promise<T> => {
  let lastError: any;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await op();
    } catch (e) {
      lastError = e;
      if (attempt === tries - 1 || !isTransient(e)) throw e;
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
// Cold-start sign-out: a plain auth().signOut() with NO Firestore teardown.
// Use this for sign-outs that happen during app startup (the reinstall
// "authed-but-no-zip" case and the orphaned-session guard) where the native
// Firestore client is freshly initialized, not wedged. Calling db.terminate()
// here would race the app-level apiConfig listener that mounts unconditionally
// before auth resolves: the listener re-issues ListenToQuery against the
// terminated client, throwing a native FIRIllegalStateException ("The client
// has already been terminated") that JS try/catch cannot catch → crash on the
// first post-reinstall launch. The full signOutClean teardown only exists to
// cure wedged gRPC streams from in-app sign-out/in cycling, which can't happen
// on a cold start.
export const signOutColdStart = async (): Promise<void> => {
  await auth().signOut();
};

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
