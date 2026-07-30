// Turns a thrown SDK error into something a customer can actually read.
//
// Firebase errors carry codes like `auth/invalid-verification-code` and messages
// like "[auth/invalid-verification-code] The sms verification code used to create
// the phone auth credential is invalid." Putting either in an Alert leaks internals
// and tells the customer nothing about what to do next, so nothing in the app should
// render `error.code` or `error.message` from an SDK directly.
//
// The rule this module enforces: a known code maps to a written sentence; anything
// unrecognised falls back to the caller's own friendly sentence. The raw text is
// never returned — it belongs in the logs, not on screen.

const FRIENDLY: Record<string, string> = {
  // --- Phone auth -----------------------------------------------------------
  'auth/invalid-verification-code': 'That code is incorrect. Check the 6 digits and try again.',
  'auth/invalid-verification-id': 'That code is no longer valid. Request a new one.',
  'auth/code-expired': 'That code has expired. Request a new one.',
  'auth/session-expired': 'That code has expired. Request a new one.',
  'auth/missing-verification-code': 'Enter the 6-digit code we sent you.',
  'auth/invalid-phone-number': "That phone number doesn't look right. Include the country code.",
  'auth/missing-phone-number': 'Enter your phone number to continue.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/quota-exceeded': "We couldn't send a code right now. Please try again shortly.",
  'auth/user-disabled': 'This account has been disabled. Contact support for help.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/captcha-check-failed': "We couldn't verify this device. Please try again.",
  'auth/operation-not-allowed': 'Phone sign-in is unavailable right now. Please try again later.',
  // Surfaces when the build's signing certificate isn't registered with Firebase —
  // nothing the customer can fix beyond running a current build.
  'auth/app-not-authorized': "We couldn't verify this app. Please update to the latest version.",

  // --- Firestore ------------------------------------------------------------
  'firestore/permission-denied': "You don't have access to that. Sign in again if this keeps happening.",
  'firestore/unauthenticated': 'Your session expired. Please sign in again.',
  'firestore/unavailable': 'Connection lost. Check your internet and try again.',
  'firestore/deadline-exceeded': 'That took too long. Check your connection and try again.',
  'firestore/not-found': "We couldn't find that — it may have been removed.",
  'firestore/already-exists': 'That already exists.',
  'firestore/cancelled': 'That was cancelled. Please try again.',
  'firestore/resource-exhausted': "We're a bit busy right now. Please try again in a moment.",
  'firestore/failed-precondition': "That couldn't be completed right now. Please try again.",
  'firestore/aborted': 'Something changed while saving. Please try again.',
  'firestore/internal': 'Something went wrong on our end. Please try again.',

  // --- Callable functions ---------------------------------------------------
  'functions/permission-denied': "You don't have permission to do that.",
  'functions/unauthenticated': 'Your session expired. Please sign in again.',
  'functions/unavailable': 'Connection lost. Check your internet and try again.',
  'functions/deadline-exceeded': 'That took too long. Check your connection and try again.',
  'functions/not-found': "We couldn't find that — it may have been removed.",
  'functions/resource-exhausted': "We're a bit busy right now. Please try again in a moment.",
  'functions/invalid-argument': "Some of those details weren't valid. Check them and try again.",
  'functions/failed-precondition': "That couldn't be completed right now. Please try again.",
  'functions/internal': 'Something went wrong on our end. Please try again.',

  // --- Storage --------------------------------------------------------------
  'storage/unauthorized': "You don't have permission to upload that.",
  'storage/unauthenticated': 'Your session expired. Please sign in again.',
  'storage/retry-limit-exceeded': 'The upload timed out. Check your connection and try again.',
  'storage/canceled': 'The upload was cancelled.',
  'storage/quota-exceeded': "We couldn't store that right now. Please try again later.",
  'storage/object-not-found': "We couldn't find that file — it may have been removed.",
};

// Namespaces to try when an error reports a bare code. The RN Firebase modules
// prefix theirs (`firestore/unavailable`), but callable functions and some JS-SDK
// paths hand back just `unavailable`, and both should resolve to the same sentence.
const NAMESPACES = ['firestore', 'functions', 'auth', 'storage'];

/**
 * A sentence safe to show the customer. `fallback` is used whenever the error isn't
 * one we have specific wording for — write it as advice, not as a description of the
 * failure ("Could not save your profile. Please try again.").
 */
export const friendlyError = (e: any, fallback: string): string => {
  const code = typeof e?.code === 'string' ? e.code.trim() : '';
  if (!code) return fallback;

  const exact = FRIENDLY[code];
  if (exact) return exact;

  const bare = code.includes('/') ? code.slice(code.indexOf('/') + 1) : code;
  for (const ns of NAMESPACES) {
    const hit = FRIENDLY[`${ns}/${bare}`];
    if (hit) return hit;
  }
  return fallback;
};

/**
 * Records a failure the app has already dealt with — one the customer was told about
 * through `friendlyError`, or one a listener degrades past on its own.
 *
 * Deliberately `console.log` rather than `console.error`. LogBox turns console.error
 * into a toast pinned over the UI, and that toast outlives the screen that raised it:
 * a sign-in that failed on the auth screen leaves `[auth/app-not-authorized]` sitting
 * across the bottom of the Explore tab long after the customer has signed in by other
 * means. Handled failures belong in the Metro/logcat stream, not on the page. Real
 * crashes still reach ErrorBoundary, which is where a dev-build toast is warranted.
 */
export const logHandledError = (scope: string, e: any): void => {
  const code = typeof e?.code === 'string' ? e.code.trim() : '';
  const message = String(e?.message ?? e ?? '');
  console.log(`[${scope}]`, code ? `${code} — ${message}` : message);
};

// Two sources DO write their message for the customer: Stripe ("Your card was
// declined.") and our own Cloud Functions HttpsError ("That promo code has expired.").
// Those are worth showing verbatim — they say more than any generic line could. Guard
// them anyway: a message carrying a bracketed code, a slash-code or a raw "Error:"
// prefix is SDK plumbing that happened to arrive on the same path.
const TECHNICAL = /\[[^\]]*\]|(^|\s)[a-z]+\/[a-z-]+|Error:|undefined|null|Exception/i;

const passThroughOrFallback = (raw: string, fallback: string): string => {
  const msg = raw.trim();
  return !msg || TECHNICAL.test(msg) ? fallback : msg;
};

/**
 * Payment-sheet errors. Shows Stripe's own wording when it reads like a sentence for
 * a customer, and the caller's fallback when it doesn't.
 */
export const friendlyPaymentError = (e: any, fallback: string): string =>
  passThroughOrFallback(String(e?.localizedMessage || e?.message || ''), fallback);

/**
 * Errors from our own callables, where the server sends copy meant to be read. Needed
 * because the codes overlap with the SDK's: a Firestore `failed-precondition` about a
 * missing index arrives under the same code as our "That promo code has expired."
 */
export const friendlyServerMessage = (e: any, fallback: string): string =>
  passThroughOrFallback(String(e?.message || ''), fallback);
