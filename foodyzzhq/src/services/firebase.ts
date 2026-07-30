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

export const ACTIVE_PROVIDER_ID_KEY = 'active_provider_id';
const LEGACY_ACTIVE_ZIP_KEY = 'active_provider_zip';

/**
 * Resolve the active store's document id.
 *
 * This used to be COMPUTED as `${signed-in phone}_${stored zip}`, which quietly
 * made "which store" a function of "who you are" — so a store could only ever
 * have one user. A store can now have several members (providers/{id}/members/
 * {E164phone}), and its doc id still carries whoever CREATED it, so the id must
 * be stored rather than derived. Returns null before a store has been selected.
 *
 * Kept as a bare AsyncStorage read: it is called on every screen mount and on
 * every foreground, so it must not touch the network or the auth SDK.
 */
export const getActiveProviderId = async (): Promise<string | null> => {
  const stored = await ReactNativeAsyncStorage.getItem(ACTIVE_PROVIDER_ID_KEY);
  if (stored) return stored;
  return migrateLegacyActiveStore();
};

/**
 * One-shot upgrade path for installs that predate ACTIVE_PROVIDER_ID_KEY.
 *
 * Those devices hold only the doc-key SUFFIX under `active_provider_zip`, which
 * is meaningless without the phone that was signed in. Recompose the id the old
 * way, persist it, and drop the legacy key. Without this every already-signed-in
 * provider would look store-less on first launch after the update and be signed
 * out by App's reinstall guard.
 *
 * Purely local — no network, no writes beyond AsyncStorage.
 */
const migrateLegacyActiveStore = async (): Promise<string | null> => {
  const zip = await ReactNativeAsyncStorage.getItem(LEGACY_ACTIVE_ZIP_KEY);
  if (!zip) return null;
  const user = auth().currentUser;
  const cleanPhone = user?.phoneNumber?.replace(/\D/g, '') || user?.email?.split('@')[0] || '';
  if (!cleanPhone) return null; // auth not resolved yet; retry on the next call
  const providerId = `${cleanPhone}_${zip}`;
  await setActiveProviderId(providerId);
  return providerId;
};

/**
 * Persist the active store. Always removes the legacy zip key so a later call to
 * migrateLegacyActiveStore can't resurrect a stale store after a switch.
 */
export const setActiveProviderId = async (providerId: string): Promise<void> => {
  await ReactNativeAsyncStorage.setItem(ACTIVE_PROVIDER_ID_KEY, providerId);
  await ReactNativeAsyncStorage.removeItem(LEGACY_ACTIVE_ZIP_KEY);
};

export const clearActiveProviderId = async (): Promise<void> => {
  await ReactNativeAsyncStorage.multiRemove([ACTIVE_PROVIDER_ID_KEY, LEGACY_ACTIVE_ZIP_KEY]);
};

/**
 * Every store the signed-in phone may operate, newest-membership last.
 *
 * One collection-group query against `members.phone`, matching the self-only
 * rule in firestore.rules — NOT a scan of `providers`. The provider docs are
 * then fetched individually (a handful at most; a person belongs to a few
 * stores, not hundreds).
 */
export const listMyStores = async (): Promise<Array<{ id: string; role: string; [k: string]: any }>> => {
  const phone = auth().currentUser?.phoneNumber;
  if (!phone) return [];
  const snap = await db.collectionGroup('members').where('phone', '==', phone).get();
  let entries = snap.docs
    .map((d) => ({ id: d.ref.parent.parent?.id || '', role: String(d.data()?.role || 'staff') }))
    .filter((e) => e.id);

  // Fallback for a store created before membership existed and not yet reached by
  // scripts/backfill-members.js: find it the old way, by the owning phone field.
  // Without this a legacy owner would look store-less and get signed out on every
  // launch — an unbreakable loop, since signing back in resolves nothing either.
  // Once backfilled (or on any store created since), this never runs.
  if (entries.length === 0) {
    const owned = await db.collection('providers')
      .where('phoneNumber', '==', phone.replace(/\D/g, '')).get();
    entries = owned.docs.map((d) => ({ id: d.id, role: 'owner' }));
  }
  if (entries.length === 0) return [];

  const docs = await Promise.all(
    entries.map((e) => db.collection('providers').doc(e.id).get().catch(() => null)),
  );
  return entries
    .map((e, i) => (docs[i]?.exists ? { ...docs[i]!.data(), id: e.id, role: e.role } : null))
    .filter(Boolean) as Array<{ id: string; role: string }>;
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
    //
    // Reconcile hqStaff as well as admin. Both claims are compared because they are
    // granted independently — hqStaff comes from store membership, admin from the
    // staff/{phone} allowlist — so a store member who is not an admin agrees with the
    // server on `admin` and would skip the refresh while still holding a token with no
    // hqStaff on it. That claim now gates every order write this app makes
    // (firestore.rules), so a device in that state can read the dispatch feed but has
    // every status advance denied.
    const claims = (await user.getIdTokenResult()).claims as any;
    const tokenHasAdmin = claims?.admin === true;
    const tokenHasHqStaff = claims?.hqStaff === true;
    const shouldBeHqStaff = res?.data?.hqStaff === true;
    if (force || res?.data?.changed ||
        tokenHasAdmin !== shouldBeAdmin || tokenHasHqStaff !== shouldBeHqStaff) {
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
 * Ask the server whether this phone may sign in, BEFORE requesting an SMS.
 *
 * Returns the resolved store when it is unambiguous, which is what lets
 * AuthScreen persist the active store before confirm() fires the auth-state
 * change. Never throws for a "no" answer — only for transport failures — so the
 * caller can distinguish "refused" from "couldn't ask".
 */
export type HqPreflight = {
  allowed: boolean;
  mode: 'member' | 'invite' | 'owner' | 'new';
  providerId?: string | null;
  storeCount?: number;
  reason?: string;
};

export const preflightHqSignIn = async (phone: string, code?: string): Promise<HqPreflight> => {
  const res: any = await functions().httpsCallable('preflightHqSignIn')({
    phone,
    ...(code ? { code } : {}),
  });
  return (res?.data ?? { allowed: false, mode: 'new' }) as HqPreflight;
};

/**
 * Redeem a single-use invite for the signed-in phone and return the store joined.
 * Server-side idempotent, so a retry after a dropped response is safe.
 */
export const redeemHqInvite = async (code: string): Promise<string> => {
  const res: any = await functions().httpsCallable('redeemHqInvite')({ code });
  const providerId = res?.data?.providerId;
  if (!providerId) throw new Error('Could not join that store. Please check the code.');
  return String(providerId);
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

// This device's Expo push token, remembered so sign-out can withdraw exactly it
// from the store's token list without re-deriving it from expo-notifications.
const PUSH_TOKEN_KEY = 'expo_push_token';

/**
 * Register this device to receive the active store's pushes.
 *
 * Writes to `fcmTokens` (arrayUnion) rather than the old scalar `fcmToken`,
 * because a store can now have several members: a single field meant whichever
 * device registered last silently became the only one receiving order alerts.
 * The server sends to the union of both fields, so devices still on the old
 * build keep working (see providerPushTokens in functions/src/index.ts).
 *
 * Only ever an UPDATE: a merge-set onto a missing doc is a CREATE, which the
 * providers rule rejects (nothing to authorize against), so a missing store is
 * skipped rather than surfacing permission-denied. Note it must NOT write
 * `phoneNumber` — for a non-owner member that would overwrite the store's owner
 * field with the member's own number.
 */
export const saveProviderFcmToken = async (providerId: string, token: string) => {
  if (!providerId || !token) return;
  const ref = firestore().collection('providers').doc(providerId);

  // Retries specifically on permission-denied, which is EXPECTED once: on a first
  // join the app enters the store before the membership that authorises this write
  // exists. AuthScreen has to persist the store id before confirm() (otherwise the
  // auth-state change finds no store and signs the user out), and the invite can
  // only be redeemed after confirm() — so for a moment the caller genuinely is not
  // yet a member and isMember() correctly says no. Without the retry the device
  // registers no push token until its next launch, which for a dispatch app means
  // silently missing orders for the rest of the session.
  for (let attempt = 0; ; attempt++) {
    try {
      const snap = await ref.get();
      if (!snap.exists) {
        if (__DEV__) console.log('No provider doc found; skipping FCM token save.');
        return;
      }
      await ref.update({ fcmTokens: firestore.FieldValue.arrayUnion(token) });
      await ReactNativeAsyncStorage.setItem(PUSH_TOKEN_KEY, token);
      if (__DEV__) console.log('Provider FCM token registered for', providerId);
      return;
    } catch (error: any) {
      const denied = String(error?.code || error?.message || '').includes('permission-denied');
      // ~5.6s total, comfortably longer than a redeem round-trip. Anything still
      // denied after that is a real permissions problem worth surfacing.
      if (!denied || attempt >= 3) {
        console.error('Error saving provider FCM token:', error);
        return;
      }
      if (__DEV__) console.log('FCM token write denied; membership may still be landing, retrying…');
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
  }
};

/**
 * Withdraw this device's push token from a store.
 *
 * Without this a member who signs out — or switches store — keeps receiving that
 * store's order alerts indefinitely, because the token stays in `fcmTokens` until
 * Expo happens to report it dead (which never happens for a still-installed app).
 *
 * Best-effort and time-boxed: sign-out must never hang on a flaky network.
 */
export const releaseProviderDevice = async (providerId?: string | null): Promise<void> => {
  try {
    const id = providerId ?? (await ReactNativeAsyncStorage.getItem(ACTIVE_PROVIDER_ID_KEY));
    const token = await ReactNativeAsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!id || !token) return;
    const ref = firestore().collection('providers').doc(id);
    // Caught inside, so losing the race below can't leave an unhandled rejection.
    const work = (async () => {
      const snap = await ref.get();
      if (!snap.exists) return;
      const update: Record<string, any> = { fcmTokens: firestore.FieldValue.arrayRemove(token) };
      // Clear the legacy scalar too, but only when it is THIS device's token — on
      // a store shared with someone still on the old build it may well be theirs.
      if (snap.data()?.fcmToken === token) update.fcmToken = firestore.FieldValue.delete();
      await ref.update(update);
    })().catch((e) => { if (__DEV__) console.warn('releaseProviderDevice write failed:', e?.message); });
    await Promise.race([work, new Promise((resolve) => setTimeout(resolve, 4000))]);
  } catch (error) {
    if (__DEV__) console.warn('releaseProviderDevice skipped:', (error as any)?.message);
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
  // Drop the active store too. It is device-scoped, not account-scoped, so a
  // leftover id would be inherited by whoever signs in next on this handset —
  // and stores are now shared, so "next" is no longer necessarily the same person.
  await clearActiveProviderId().catch(() => {});
  await auth().signOut();
};

export const signOutClean = async (): Promise<void> => {
  // Withdraw this device from the store's push list FIRST — it needs the auth
  // token that signOut() is about to discard. Best-effort and time-boxed inside.
  await releaseProviderDevice();
  await clearActiveProviderId();
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
