// Customer verification before Rent / Rent to Buy: identity (Didit), proof of
// address, and the sign-up location. The server decides every result
// (functions/src/customerVerification.ts) and writes the derived status to
// users/{phone}.verification, which the app reads through the profile listener.
// Nothing here is trusted: the checkout itself is refused server-side until the
// status is `verified`.
import * as Location from 'expo-location';
import * as WebBrowser from 'expo-web-browser';
import { getFunctionsInstance } from './firebase';
import type { Verification } from '../types';

export const EMPTY_VERIFICATION: Verification = {
  status: 'action_required',
  identity: 'not_started',
  address: 'waiting',
  location: 'not_started',
};

export type VerificationStatusResponse = {
  verification: Verification;
  required: boolean;
  radiusMiles: number;
  notes: { identity?: string; address?: string; location?: string };
};

const call = async <T,>(name: string, data: Record<string, unknown> = {}): Promise<T> =>
  (await getFunctionsInstance().httpsCallable(name)(data)).data as T;

/** Rent and Rent to Buy need verification; Buy is paid in full and does not. */
export const rentalNeedsVerification = (rentalType: string | null | undefined) =>
  rentalType === 'rent' || rentalType === 'rentToBuy';

export const getVerificationStatus = () => call<VerificationStatusResponse>('getVerificationStatus');

export const submitVerificationDocuments = (target: 'identity' | 'address') =>
  call<{ verification: Verification }>('submitVerificationDocuments', { target });

/** The server answers `already_verified` when a webhook got there first — that's success, not an error. */
export const isAlreadyVerified = (e: any) => String(e?.message || '').includes('already_verified');

/** A checkout refused by the server's verification gate. */
export const isVerificationRequired = (e: any) => String(e?.message || '').includes('verification_required');

// ── Identity (Didit) ────────────────────────────────────────────────────────
// Didit's hosted flow runs in the system browser sheet; the customer closes it
// when Didit shows its "done" page. (openAuthSessionAsync would also close it on a
// redirect to our scheme, should the session ever be created with that callback.)
// Either way the result on the device is only a hint — the caller polls next.
const RETURN_URL = 'com.rajshrestha.foodyzz://verification-done';

export async function runIdentityCheck(): Promise<'finished' | 'cancelled'> {
  const session = await call<{ url: string }>('startIdentityVerification');
  if (!session?.url) throw new Error('Verification link unavailable.');
  const res = await WebBrowser.openAuthSessionAsync(session.url, RETURN_URL, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
  });
  return res.type === 'cancel' || res.type === 'dismiss' ? 'cancelled' : 'finished';
}

// Didit's decision usually lands within seconds of the flow closing.
export const POLL_DELAYS_MS = [0, 2000, 3000, 5000, 8000];

/** Polls until the identity check leaves `in_progress`, or the delays run out. */
export async function pollVerification(isMounted: () => boolean): Promise<VerificationStatusResponse | null> {
  let last: VerificationStatusResponse | null = null;
  for (const wait of POLL_DELAYS_MS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (!isMounted()) return last;
    try {
      last = await getVerificationStatus();
      if (last.verification.identity !== 'in_progress') break;
    } catch {
      // Keep polling; the last successful answer (if any) is returned.
    }
  }
  return last;
}

// ── Location ────────────────────────────────────────────────────────────────
export type LocationOutcome =
  | { ok: true; location: Verification['location'] }
  | { ok: false; reason: 'denied' | 'unavailable' };

/** One high-accuracy fix, sent to the server, which compares it with the delivery address. */
export async function checkLocationAtAddress(): Promise<LocationOutcome> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') return { ok: false, reason: 'denied' };
  let fix: Location.LocationObject;
  try {
    fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const res = await call<{ location: Verification['location'] }>('recordVerificationLocation', {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracyM: fix.coords.accuracy ?? null,
  });
  return { ok: true, location: res.location };
}
