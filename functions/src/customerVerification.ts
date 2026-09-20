/**
 * Customer verification before a Rent or Rent to Buy checkout.
 *
 * Modelled on the Suds provider onboarding (suds/functions/src/individual.ts) but
 * for Foodyzz CUSTOMERS. Three checks, each of which passes on its own:
 *
 *   identity  — a Didit session (ID document + liveness + face match). If Didit
 *               declines, the customer can instead upload their licence and a
 *               selfie for a person at FoodyzzHQ to approve.
 *   address   — passes automatically when the ZIP on the Didit-verified ID matches
 *               the delivery address on the profile; otherwise the customer uploads
 *               a proof of address (utility bill, statement) for review.
 *   location  — the phone's GPS, taken when the customer says "I'm at my delivery
 *               address", must be within `radiusMiles` of that address. The request
 *               IP is looked up too: an IP outside the US, or a proxy, sends an
 *               otherwise-passing check to a person instead of passing it. Staff
 *               can override a failed location check.
 *
 * Where things live
 *   customerKyc/{phone}   — server-only (firestore.rules default deny): the Didit
 *                           summary, GPS + IP capture, manual-review records.
 *   diditEvents/{eventId} — server-only webhook deliveries (idempotency).
 *   users/{phone}.verification — the DERIVED status only ({ status, identity,
 *                           address, location, updatedAt }), server-written. The
 *                           users doc is readable by every signed-in user, so no
 *                           PII goes there. Rules stop the customer writing it.
 *   Storage customerKyc/{phone}/portrait.jpg — Didit's selfie, for reviewers only.
 *
 * Reviews are tied to the delivery address they were made for (`forAddress`), so
 * changing the profile address sends address and location back to the customer
 * without anyone having to remember to reset them.
 */
import {onCall, onRequest, HttpsError, type CallableRequest} from "firebase-functions/v2/https";
import {onDocumentCreated} from "firebase-functions/v2/firestore";
import {getFirestore, FieldValue} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";
import {isIP} from "net";
import {
  diditApi, loadDiditConfig, verifyDiditWebhook, summarizeDecision, portraitUrlOf, livenessImageUrlOf, compact, zipOf,
  FINAL_DIDIT_STATUSES,
} from "./didit";
import {lookupIpLocation, isPrivateIp, type IpLocation} from "./ipLocation";

const db = () => getFirestore();

// ── Hooks ───────────────────────────────────────────────────────────────────
// Mail and push live in index.ts, which imports this module; index.ts installs
// them at load (installVerificationHooks) instead of this file importing index.ts
// back. Tests replace them with spies.
export const verificationHooks = {
  notifyCustomer: async (_phone: string, _title: string, _body: string, _type: string): Promise<void> => undefined,
  emailAdmin: async (_subject: string, _title: string, _intro: string, _rows: [string, string][]): Promise<void> => undefined,
};
export function installVerificationHooks(h: Partial<typeof verificationHooks>): void {
  Object.assign(verificationHooks, h);
}

// ── Storage (one object so tests can spy on it; the test suite has no Storage) ─
export const kycFiles = {
  async save(path: string, buf: Buffer, contentType: string): Promise<void> {
    await getStorage().bucket().file(path).save(buf, {contentType, resumable: false});
  },
  async download(path: string): Promise<Buffer> {
    const [buf] = await getStorage().bucket().file(path).download();
    return buf;
  },
};

// ── Types ───────────────────────────────────────────────────────────────────
export type IdentityState = "not_started" | "in_progress" | "failed" | "in_review" | "rejected" | "verified";
export type AddressState = "waiting" | "needs_document" | "in_review" | "rejected" | "verified";
export type LocationState = "not_started" | "too_far" | "in_review" | "rejected" | "verified";
export type OverallState = "action_required" | "in_review" | "verified";

export interface Verification {
  status: OverallState;
  identity: IdentityState;
  address: AddressState;
  location: LocationState;
}

// ── Config ──────────────────────────────────────────────────────────────────
// apiConfig/global.verification = { required?: boolean, radiusMiles?: number }.
// `required` is OFF until set: the checkout gate must not go live before a customer
// app that can complete verification is in the stores, or every Rent checkout on
// the old build would be refused with no way forward.
export const DEFAULT_RADIUS_MILES = 0.25;
export const MAX_DIDIT_SESSIONS_PER_DAY = 5;
export const MAX_LOCATION_CHECKS_PER_DAY = 20;
export const MAX_SUBMISSIONS_PER_DAY = 10;

// ── Stale clients ───────────────────────────────────────────────────────────
// A build without the Verification screen cannot resolve a `verification_required`
// refusal: its checkout catch is `Alert.alert('Error', error.message)`, so the raw
// token is what the customer reads, with no way forward. Those callers are told to
// update instead — the message below IS the alert body on that build. Anything
// that declares a new enough `appVersion` gets the token, which its checkout
// catches and turns into the verification prompt.
//
// Raise apiConfig/global.verification.minAppVersion to retire a build later;
// it needs no redeploy.
export const MIN_VERIFIED_APP_VERSION = "3.0.0";
export const UPDATE_REQUIRED_MESSAGE =
  "App update required. Please update Foodyzz from the App Store or Google Play to keep renting.";

/** Dotted numeric version to [major, minor, patch] — null if it isn't one. */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== "string") return null;
  const out = v.trim().split(".").slice(0, 3).map((n) => Number.parseInt(n, 10));
  while (out.length < 3) out.push(0);
  return out.every((n) => Number.isInteger(n) && n >= 0) ? out : null;
}

/**
 * `a >= b`. A missing or unparseable client version is old, so it is told to
 * update. An unparseable floor is ignored rather than obeyed: a typo in
 * minAppVersion must not tell every customer on every build to update.
 */
export function versionAtLeast(a: unknown, b: string): boolean {
  const got = parseVersion(a);
  if (!got) return false;
  const want = parseVersion(b);
  if (!want) return true;
  for (let i = 0; i < 3; i++) {
    if (got[i] !== want[i]) return got[i] > want[i];
  }
  return true;
}

/** Digits only, so a number typed into the console with spaces, dashes or no `+` still matches. */
const phoneKey = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// ── TEMPORARY: while the old app is still in production ─────────────────────
// `legacy: true` means 2.1.0 is still out there. That build has no Verification
// screen, so a `verification_required` refusal dead-ends it — the customer sees a
// raw "verification_required" alert and has no way to resolve it. While legacy is
// set, the gate therefore applies ONLY to `pilotPhones`, so the feature can be
// tested end to end against real production data without touching anyone else.
//
// It defaults to ON: a missing flag means nobody has confirmed the old build is
// gone, and the safe reading of that is to leave existing customers alone.
//
// Setting `legacy: false` is the go-live switch — and the cue to DELETE this
// block: drop `legacy` and `pilotPhones` from apiConfig/global.verification,
// drop the `phone` parameter here and at its four call sites, and restore
// `required: c.required === true`.
export async function verificationConfig(phone?: string):
  Promise<{ required: boolean; radiusMiles: number; minAppVersion: string }> {
  const c: any = (await db().doc("apiConfig/global").get()).data()?.verification ?? {};
  const r = Number(c.radiusMiles);
  const legacy = c.legacy !== false;
  const pilot: string[] = Array.isArray(c.pilotPhones) ? c.pilotPhones.map(phoneKey) : [];
  const caller = phoneKey(phone);
  return {
    required: c.required === true && (!legacy || (!!caller && pilot.includes(caller))),
    radiusMiles: Number.isFinite(r) && r > 0 ? r : DEFAULT_RADIUS_MILES,
    minAppVersion: parseVersion(c.minAppVersion) ? String(c.minAppVersion) : MIN_VERIFIED_APP_VERSION,
  };
}

// ── Pure helpers (exported for tests) ───────────────────────────────────────

/** Great-circle miles, unrounded. */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const finiteIn = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
const nowIso = () => new Date().toISOString();

/**
 * The delivery address a review or GPS check was made for. Any change to the
 * profile address makes earlier address/location results stop applying.
 */
export function addressKey(user: any): string {
  const norm = (s: unknown) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(user?.address)}|${norm(user?.zipCode)}`;
}

export const profileZip = (user: any): string | undefined =>
  (/^\d{5}/.test(String(user?.zipCode ?? "")) ? String(user.zipCode).slice(0, 5) : undefined) ?? zipOf(user?.address);

/** An IP result a person should look at before the location check passes. */
export function ipNeedsReview(ip: IpLocation | null | undefined): boolean {
  if (!ip) return false; // lookup failed or private: never block on a third party
  return ip.proxy === true || (!!ip.countryCode && ip.countryCode.toUpperCase() !== "US");
}

/**
 * The caller's IP. Google's front end APPENDS the address it saw to
 * X-Forwarded-For; everything left of it came from the client and can be forged,
 * so the chain is read from the RIGHT, skipping our own private hops.
 */
export function clientIpOf(req: any): string | null {
  if (!req) return null;
  const hops = String(req.headers?.["x-forwarded-for"] || "")
    .split(",").map((s) => s.trim()).filter((s) => isIP(s) !== 0);
  for (let i = hops.length - 1; i >= 0; i--) {
    if (!isPrivateIp(hops[i])) return hops[i];
  }
  const ip = String(req.ip || "").trim() || hops[hops.length - 1] || "";
  return ip || null;
}

const PROGRESS_DIDIT = new Set(["Not Started", "In Progress", "Resubmitted"]);

/**
 * What still counts after a staff re-request (adminRequestCustomerVerification).
 *
 * Staff asking for a check again is a statement that what is on file no longer
 * satisfies them, so every record the customer produced BEFORE they asked stops
 * counting and the check lands back on the customer as something to do. The
 * request closes itself the moment the customer produces something newer — a
 * fresh Didit session, new licence photos, another proof of address — so nothing
 * has to be cleared by hand, and the superseded record stays on customerKyc for
 * a reviewer to look at. Pure; exported for the callables' "already verified"
 * guards, which must let a reopened customer start over.
 */
export function currentVerificationRecords(kyc: any, user: any): {
  didit: any; identityReview: any; addressReview: any; identityOpen: boolean; addressOpen: boolean;
  } {
  const k = kyc ?? {};
  const askedAt = (t: "identity" | "address") => String(k.requests?.[t]?.requestedAt ?? "");
  // Only a real ISO timestamp can close a request. Some of these stamps are copied
  // out of users/{phone} by the old document path, where rules only guarantee that
  // staff wrote a non-null value — so anything unparseable counts as OLDER, leaving
  // the check open rather than quietly passing it on a string comparison.
  const iso = (v: unknown): string => {
    const t = String(v ?? "");
    return /^\d{4}-\d{2}-\d{2}T/.test(t) && !Number.isNaN(Date.parse(t)) ? t : "";
  };
  // A record counts when there was no request, or when it is newer than the request.
  const since = (rec: any, at: unknown, asked: string) => (!asked || iso(at) > asked ? rec : null);

  const idAsked = askedAt("identity");
  const didit = since(k.didit, k.didit?.updatedAt, idAsked);
  const identityReview = since(k.identityReview, k.identityReview?.reviewedAt ?? k.identityReview?.submittedAt, idAsked);

  // Only a document answers a request for a document: the address review is the
  // one record that can close it (the ID's ZIP cannot, see below).
  const addrAsked = askedAt("address");
  const forAddress = k.addressReview?.forAddress === addressKey(user) ? k.addressReview : null;
  const addressReview = since(forAddress, forAddress?.reviewedAt ?? forAddress?.submittedAt, addrAsked);

  return {
    didit,
    identityReview,
    addressReview,
    identityOpen: !!idAsked && !didit && !identityReview,
    addressOpen: !!addrAsked && !addressReview,
  };
}

/** The three checks and the overall status, from the KYC record and the profile. Pure. */
export function deriveVerification(kyc: any, user: any, radiusMiles: number): Verification {
  const k = kyc ?? {};
  const rec = currentVerificationRecords(k, user);
  const didit = String(rec.didit?.status ?? "");
  const manual = rec.identityReview?.status;

  let identity: IdentityState;
  if (manual === "approved" || didit === "Approved") identity = "verified";
  else if (manual === "submitted" || didit === "In Review") identity = "in_review";
  else if (manual === "rejected") identity = "rejected";
  else if (didit === "Declined") identity = "failed";
  else if (PROGRESS_DIDIT.has(didit)) identity = "in_progress";
  else identity = "not_started"; // none yet, reopened, or Abandoned / Expired: start again

  const key = addressKey(user);
  const addrReview = rec.addressReview;
  let address: AddressState;
  if (addrReview?.status === "approved") address = "verified";
  else if (addrReview?.status === "submitted") address = "in_review";
  // A matching ZIP on the ID is not an answer to staff asking for a document.
  else if (!rec.addressOpen && didit === "Approved" && rec.didit?.idZip && rec.didit.idZip === profileZip(user)) address = "verified";
  else if (addrReview?.status === "rejected") address = "rejected";
  // Staff asked for a document, so the customer can send one whatever else is
  // outstanding — including an identity check that has not finished.
  else if (rec.addressOpen) address = "needs_document";
  // Until identity is settled there is nothing to compare the address with; the
  // customer may still upload a document early.
  else if (identity !== "verified") address = "waiting";
  else address = "needs_document";

  const locReview = k.locationReview?.forAddress === key ? k.locationReview : null;
  const loc = k.location?.forAddress === key ? k.location : null;
  let location: LocationState;
  if (locReview?.status === "approved") location = "verified";
  else if (locReview?.status === "rejected" && (!loc || loc.capturedAt <= locReview.reviewedAt)) location = "rejected";
  else if (!loc) location = "not_started";
  else if (typeof loc.distanceMiles !== "number") location = "in_review"; // profile had no coordinates
  else if (loc.distanceMiles > radiusMiles) location = "too_far";
  else if (ipNeedsReview(loc.ipLocation)) location = "in_review";
  else location = "verified";

  // Identity and sign-up location are the gate. Proof of address is advisory: it
  // is only ever asked for when the ID and the delivery address disagree, and by
  // then we already know who the customer is and that they are standing at the
  // address the bike goes to. Blocking the rental on it stranded customers who
  // had passed both real checks, so `address` is still derived and shown — staff
  // can chase a document, and the panel reports it — but it does not hold up the
  // hand-over either way.
  const parts: string[] = [identity, location];
  let status: OverallState;
  if (parts.every((p) => p === "verified")) status = "verified";
  else if (parts.some((p) => ["not_started", "in_progress", "failed", "rejected", "needs_document", "too_far"].includes(p))) {
    status = "action_required";
  } else status = "in_review";
  return {status, identity, address, location};
}

// ── Records ─────────────────────────────────────────────────────────────────
const kycRef = (phone: string) => db().doc(`customerKyc/${phone}`);
const userRef = (phone: string) => db().doc(`users/${phone}`);

function callerPhone(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const phone = String(request.auth.token?.phone_number ?? "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new HttpsError("permission-denied", "Sign in with your phone number first.");
  return phone;
}

function phoneArg(data: any): string {
  const phone = String(data?.phone ?? "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new HttpsError("invalid-argument", "phone required.");
  return phone;
}

/** Admin console (admin claim) or FoodyzzHQ staff (hqStaff) — the people who review documents today. */
function assertStaff(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const t: any = request.auth.token ?? {};
  if (t.admin !== true && t.hqStaff !== true) throw new HttpsError("permission-denied", "Staff only.");
  return String(t.email || t.phone_number || request.auth.uid || "staff");
}

async function requireOnboardedUser(phone: string): Promise<any> {
  const user = (await userRef(phone).get()).data();
  if (!user || user.onboarded !== true) throw new HttpsError("failed-precondition", "Finish setting up your profile first.");
  return user;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Spends one unit of a rolling 24h budget on customerKyc/{phone}.limits[key], creating the record if needed. */
async function spendDailyBudget(phone: string, key: string, max: number, what: string): Promise<void> {
  const now = Date.now();
  const ok = await db().runTransaction(async (tx) => {
    const snap = await tx.get(kycRef(phone));
    const prev: any = snap.data()?.limits?.[key];
    const inWindow = prev && now - Number(prev.windowStartedAt ?? 0) < DAY_MS;
    const count = (inWindow ? Number(prev.count ?? 0) : 0) + 1;
    if (count > max) return false;
    const limit = {windowStartedAt: inWindow ? Number(prev.windowStartedAt) : now, count};
    if (snap.exists) tx.update(kycRef(phone), {[`limits.${key}`]: limit});
    else tx.set(kycRef(phone), {phone, createdAt: nowIso(), updatedAt: nowIso(), limits: {[key]: limit}});
    return true;
  });
  if (!ok) throw new HttpsError("resource-exhausted", `Too many ${what} today. Please try again tomorrow.`);
}

// ── Recompute + notifications ───────────────────────────────────────────────
const LABEL: Record<string, string> = {identity: "Identity", address: "Proof of address", location: "Sign-up location"};

/**
 * Re-derives the status, stores it on users/{phone}.verification when it changed,
 * and announces transitions: staff are emailed when something lands in their
 * queue, the customer is pushed when a check passes or needs them again.
 */
export async function recomputeVerification(
  phone: string, opts: { quietRejections?: boolean } = {},
): Promise<Verification | null> {
  const [kSnap, uSnap, cfg] = await Promise.all([kycRef(phone).get(), userRef(phone).get(), verificationConfig(phone)]);
  const user = uSnap.data();
  if (!user) return null;
  if (!kSnap.exists && !user.verification) return null;
  const next = deriveVerification(kSnap.data(), user, cfg.radiusMiles);
  const prev = user.verification ?? {};
  if (prev.status === next.status && prev.identity === next.identity &&
      prev.address === next.address && prev.location === next.location) return next;

  await userRef(phone).update({verification: {...next, updatedAt: nowIso()}});

  const k: any = kSnap.data() ?? {};
  const name = String(user.name || phone);
  for (const part of ["identity", "address", "location"] as const) {
    const was = prev[part];
    const now = next[part];
    if (was === now) continue;
    if (now === "in_review" || (part === "location" && now === "too_far")) {
      const why = part === "identity" ?
        (k.identityReview?.status === "submitted" ? "Uploaded a licence and selfie after the automatic ID check did not pass." : "Didit sent the ID check to manual review.") :
        part === "address" ? "Uploaded a proof of address." :
        now === "too_far" ?
          `Phone was ${k.location?.distanceMiles ?? "?"} mi from the delivery address (limit ${cfg.radiusMiles} mi). Blocked until they retry from the address or staff override.` :
          typeof k.location?.distanceMiles !== "number" ?
            "The delivery address has no map coordinates, so the phone's location could not be compared." :
            `IP looks unusual: ${[k.location?.ipLocation?.city, k.location?.ipLocation?.region, k.location?.ipLocation?.country].filter(Boolean).join(", ") || "unknown"}` +
            `${k.location?.ipLocation?.proxy ? " (proxy)" : ""}.`;
      await verificationHooks.emailAdmin(
        `Verification review: ${name} — ${LABEL[part]}`,
        `${LABEL[part]} needs a look`,
        `${name} needs a FoodyzzHQ review before they can rent. Open the customer in FoodyzzHQ → Verifications.`,
        [["Customer", name], ["Phone", phone], ["Delivery address", String(user.address || "—")], ["Why", why]],
      ).catch((e) => logger.error(`verification admin email failed for ${phone}`, e));
    }
  }

  if (next.status === "verified" && prev.status !== "verified") {
    await verificationHooks.notifyCustomer(phone, "You're verified ✅",
      "Your identity, address and location checks are complete. You can now rent a bike.", "VERIFICATION_COMPLETE");
  } else if (!opts.quietRejections) {
    const rejected = (["identity", "address", "location"] as const)
      .find((p) => next[p] === "rejected" && prev[p] !== "rejected");
    if (rejected) {
      const note = rejected === "identity" ? k.identityReview?.note : rejected === "address" ? k.addressReview?.note : k.locationReview?.note;
      await verificationHooks.notifyCustomer(phone, `${LABEL[rejected]} not accepted`,
        `${note ? `${note} ` : ""}Open Account → Verification in Foodyzz to try again.`, "VERIFICATION_REJECTED");
    }
  }
  return next;
}

/**
 * Throws unless this customer may check out a Rent / Rent to Buy order. No-op
 * while the gate is off. `appVersion` is what the client says it is running; a
 * build too old to show the Verification screen is told to update instead.
 */
export async function assertVerifiedForRental(phone: string, appVersion?: unknown): Promise<void> {
  const cfg = await verificationConfig(phone);
  if (!cfg.required) return;
  const v = await recomputeVerification(phone);
  if (v?.status !== "verified") {
    if (!versionAtLeast(appVersion, cfg.minAppVersion)) {
      throw new HttpsError("failed-precondition", UPDATE_REQUIRED_MESSAGE);
    }
    throw new HttpsError("failed-precondition", "verification_required");
  }
}

// ── Didit ───────────────────────────────────────────────────────────────────

/** Starts a fresh Didit session. Every attempt gets a new one — a declined session can't be reused. */
export const startIdentityVerification = onCall(async (request) => {
  const phone = callerPhone(request);
  const user = await requireOnboardedUser(phone);
  const k: any = (await kycRef(phone).get()).data();
  // "Already verified" is about what still COUNTS: a customer whose identity staff
  // have asked for again has to be able to start a fresh session.
  if (!currentVerificationRecords(k, user).identityOpen &&
      (k?.didit?.status === "Approved" || k?.identityReview?.status === "approved")) {
    throw new HttpsError("failed-precondition", "already_verified");
  }
  await spendDailyBudget(phone, "didit", MAX_DIDIT_SESSIONS_PER_DAY, "verification attempts");
  const cfg = await loadDiditConfig();
  let session: any;
  try {
    session = await diditApi.createSession(cfg, phone);
  } catch (err: any) {
    logger.error(`startIdentityVerification: Didit session create failed for ${phone}: ${err?.message || err}`);
    // A 4xx is OUR configuration (bad key, wrong workflow), which retrying never fixes.
    const status = Number(String(err?.message || "").match(/HTTP (\d{3})/)?.[1] || 0);
    if (status >= 400 && status < 500) {
      throw new HttpsError("failed-precondition",
        "Identity verification is misconfigured on our side. Support has been notified — please try again later.");
    }
    throw new HttpsError("unavailable", "Could not start identity verification. Please try again.");
  }
  if (!session?.session_id || !session?.session_token) {
    throw new HttpsError("unavailable", "Could not start identity verification. Please try again.");
  }
  const now = nowIso();
  // A new session replaces the previous attempt, and a new attempt is a new
  // chance: a staff rejection of the earlier manual upload no longer applies.
  const upd: Record<string, unknown> = {
    didit: {sessionId: String(session.session_id), status: String(session.status || "Not Started"), updatedAt: now},
    updatedAt: now,
  };
  if (k?.identityReview?.status === "rejected") upd.identityReview = FieldValue.delete();
  await kycRef(phone).update(upd);
  await recomputeVerification(phone);
  return {sessionId: String(session.session_id), sessionToken: String(session.session_token), url: String(session.url ?? "")};
});

// Progress statuses never overwrite a decided session: webhook deliveries are
// retried and arrive out of order.
const PROGRESS_STATUSES = new Set(["Not Started", "In Progress", "In Review", "Resubmitted"]);

/** Applies a Didit status (and decision) to customerKyc. Idempotent; shared by the webhook and the status poll. */
export async function applyDiditResult(
  phone: string, sessionId: string, status: string, decision: any, fetchedAtMs: number = Date.now(),
): Promise<void> {
  const now = nowIso();
  const outcome = await db().runTransaction(async (tx) => {
    const snap = await tx.get(kycRef(phone));
    const k: any = snap.data();
    if (!k || k.didit?.sessionId !== sessionId) return null;
    const prevStatus = String(k.didit?.status ?? "");
    if ((prevStatus === "Approved" || prevStatus === "Declined") && PROGRESS_STATUSES.has(status)) return null;
    if (Number(k.didit?.decisionFetchedAt ?? 0) > fetchedAtMs) return null;
    const summary = decision ? summarizeDecision(decision) : {};
    tx.update(kycRef(phone), {
      didit: {...k.didit, ...summary, sessionId, status, updatedAt: now, decisionFetchedAt: fetchedAtMs},
      updatedAt: now,
    });
    return {prevStatus, portraitPath: k.didit?.portraitPath as string | undefined};
  });
  if (!outcome) return;

  if (status === "Approved" && !outcome.portraitPath) {
    // The reviewer's reference photo. Best-effort: a missing portrait never
    // un-verifies anyone.
    const url = portraitUrlOf(decision);
    if (url) {
      try {
        const buf = await diditApi.downloadImage(url);
        const path = `customerKyc/${phone}/portrait.jpg`;
        await kycFiles.save(path, buf, "image/jpeg");
        await kycRef(phone).update({"didit.portraitPath": path});
        // A Didit-verified customer may never have uploaded a selfie, and the worker
        // ID badge needs one. The liveness selfie (never the ID-card crop) becomes
        // their selfie, already reviewed — unless they have one on file.
        const user = (await userRef(phone).get()).data();
        if (url === livenessImageUrlOf(decision) && user && !user.selfie?.frontPath) {
          const selfiePath = `selfies/${phone}/didit-${Date.now()}.jpg`;
          await kycFiles.save(selfiePath, buf, "image/jpeg");
          const at = nowIso();
          await userRef(phone).update({
            selfie: {frontPath: selfiePath, uploadedAt: at, reviewedAt: at, reviewedBy: "didit", rejectedReason: null},
          });
        }
      } catch (err: any) {
        logger.warn(`applyDiditResult: portrait copy failed for ${phone}: ${err?.message || err}`);
      }
    }
  }
  if (status === "Declined" && outcome.prevStatus !== "Declined") {
    await verificationHooks.notifyCustomer(phone, "ID check didn't pass",
      "Try again with better lighting, or upload photos of your licence and a selfie for our team to review.",
      "VERIFICATION_DECLINED");
  }
  await recomputeVerification(phone);
}

/** Refreshes Didit while a session can still change (the app polls this after Didit closes). */
export const getVerificationStatus = onCall(async (request) => {
  const phone = callerPhone(request);
  let k: any = (await kycRef(phone).get()).data();
  const didit = k?.didit;
  if (didit?.sessionId && !FINAL_DIDIT_STATUSES.has(didit.status)) {
    try {
      const fetchedAt = Date.now();
      const decision = await diditApi.getDecision(await loadDiditConfig(), didit.sessionId);
      const status = String(decision?.status ?? "");
      if (status) await applyDiditResult(phone, didit.sessionId, status, decision, fetchedAt);
      k = (await kycRef(phone).get()).data();
    } catch (err: any) {
      // The stored status is still a true answer, just possibly a stale one.
      logger.warn(`getVerificationStatus: refresh failed for ${phone}: ${err?.message || err}`);
    }
  }
  const v = await recomputeVerification(phone);
  const cfg = await verificationConfig(phone);
  return {
    verification: v ?? {status: "action_required", identity: "not_started", address: "waiting", location: "not_started"},
    required: cfg.required,
    radiusMiles: cfg.radiusMiles,
    // Reviewer notes are addressed to the customer; everything else stays server-side.
    notes: compact({
      identity: k?.identityReview?.status === "rejected" ? k.identityReview.note : undefined,
      address: k?.addressReview?.status === "rejected" ? k.addressReview.note : undefined,
      location: k?.locationReview?.status === "rejected" ? k.locationReview.note : undefined,
    }),
  };
});

// ── Webhook ─────────────────────────────────────────────────────────────────
// URL: https://us-central1-foodyzz-27b3e.cloudfunctions.net/diditWebhook
// Verifies and records the delivery, then answers (Didit gives up after 5s); the
// work happens in onDiditEventCreated. The doc's create() is the idempotency check.
// invoker "public": Didit calls from its own infrastructure; the HMAC is the auth.
export const diditWebhook = onRequest({invoker: "public"}, async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("POST only");
    return;
  }
  let parsed: any;
  try {
    const raw = (req as any).rawBody ? (req as any).rawBody.toString("utf8") : null;
    parsed = raw ? JSON.parse(raw) : req.body;
  } catch {
    res.status(400).send("bad json");
    return;
  }
  if (!parsed || typeof parsed !== "object") {
    res.status(400).send("bad json");
    return;
  }

  let secret: string;
  try {
    secret = (await loadDiditConfig()).webhookSecret;
  } catch (err: any) {
    logger.error(`diditWebhook: ${err?.message || err}`);
    res.status(503).send("not configured");
    return;
  }
  const verdict = verifyDiditWebhook(parsed, String(req.headers["x-signature-v2"] ?? ""), req.headers["x-timestamp"], secret);
  if (verdict !== "ok") {
    logger.warn(`diditWebhook: rejected delivery (${verdict})`);
    res.status(401).send(verdict);
    return;
  }

  const rawId = String(parsed.event_id ?? "");
  const eventId = /^[A-Za-z0-9_-]{1,128}$/.test(rawId) ?
    rawId :
    crypto.createHash("sha256").update(rawId || `${parsed.session_id}|${parsed.webhook_type}|${parsed.timestamp}`).digest("hex").slice(0, 40);
  try {
    await db().doc(`diditEvents/${eventId}`).create(compact({
      receivedAt: nowIso(),
      eventId: parsed.event_id ? String(parsed.event_id) : undefined,
      sessionId: String(parsed.session_id ?? ""),
      status: String(parsed.status ?? ""),
      vendorData: String(parsed.vendor_data ?? ""),
      webhookType: String(parsed.webhook_type ?? ""),
    }));
  } catch (err: any) {
    if (err?.code === 6 || /already exists/i.test(String(err?.message))) {
      res.status(200).json({ok: true, duplicate: true});
      return;
    }
    logger.error("diditWebhook: could not record event", err);
    res.status(500).send("error");
    return;
  }
  res.status(200).json({ok: true});
});

/**
 * Processes one recorded delivery. The body is only a nudge: the status applied is
 * the decision re-read from Didit, so a stale retried "Approved" can't win over a
 * later "Declined", and no PII is stored on the event.
 */
export async function processDiditEvent(eventId: string, ev: any): Promise<void> {
  const phone = String(ev?.vendorData ?? "");
  const sessionId = String(ev?.sessionId ?? "");
  const bodyStatus = String(ev?.status ?? "");
  const eventRef = db().doc(`diditEvents/${eventId}`);
  if (!/^\+\d{8,15}$/.test(phone) || !sessionId || !bodyStatus) {
    await eventRef.update({processedAt: nowIso(), ignored: "not_a_foodyzz_session"});
    return;
  }
  const k = (await kycRef(phone).get()).data();
  if (!k || k.didit?.sessionId !== sessionId) {
    await eventRef.update({processedAt: nowIso(), ignored: "not_current_session"});
    return;
  }
  const fetchedAt = Date.now();
  let decision: any = null;
  let status = "";
  try {
    decision = await diditApi.getDecision(await loadDiditConfig(), sessionId);
    status = String(decision?.status ?? "");
  } catch (err) {
    // An in-progress session may have no decision yet; only a progress status may
    // fall back to the body, and those never overwrite a decided session.
    if (!PROGRESS_STATUSES.has(bodyStatus)) throw err;
    status = bodyStatus;
    decision = null;
  }
  if (!status) {
    await eventRef.update({processedAt: nowIso(), ignored: "no_decision_status"});
    return;
  }
  await applyDiditResult(phone, sessionId, status, decision, fetchedAt);
  await eventRef.update(compact({processedAt: nowIso(), appliedStatus: status, bodyStatus: bodyStatus !== status ? bodyStatus : undefined}));
}

export const onDiditEventCreated = onDocumentCreated("diditEvents/{eventId}", async (event) => {
  const eventId = event.params.eventId;
  try {
    await processDiditEvent(eventId, event.data?.data());
  } catch (err: any) {
    // Not retried: getVerificationStatus re-reads the decision while the app waits.
    logger.error(`onDiditEventCreated: ${eventId} failed: ${err?.message || err}`);
    await db().doc(`diditEvents/${eventId}`).update({error: String(err?.message || err).slice(0, 500)}).catch(() => undefined);
  }
});

// ── Location ────────────────────────────────────────────────────────────────
export const recordVerificationLocation = onCall(async (request) => {
  const phone = callerPhone(request);
  const {lat, lng, accuracyM} = request.data ?? {};
  if (!finiteIn(lat, -90, 90) || !finiteIn(lng, -180, 180)) {
    throw new HttpsError("invalid-argument", "A valid device location is required.");
  }
  const user = await requireOnboardedUser(phone);
  await spendDailyBudget(phone, "location", MAX_LOCATION_CHECKS_PER_DAY, "location checks");

  const hasHome = typeof user.lat === "number" && typeof user.lng === "number";
  const dist = hasHome ? round(distanceMiles({lat, lng}, {lat: user.lat, lng: user.lng}), 3) : null;
  const ip = clientIpOf(request.rawRequest);
  // Corroboration only — a slow or unreachable lookup returns null and never blocks.
  const ipLocation = await lookupIpLocation(ip);
  const now = nowIso();
  await kycRef(phone).update({
    location: compact({
      forAddress: addressKey(user),
      deviceLat: lat, deviceLng: lng,
      accuracyM: typeof accuracyM === "number" && Number.isFinite(accuracyM) ? accuracyM : null,
      addressLat: hasHome ? user.lat : null,
      addressLng: hasHome ? user.lng : null,
      ip,
      ipLocation: ipLocation ?? undefined,
      capturedAt: now,
      distanceMiles: dist,
    }),
    updatedAt: now,
  });
  const v = await recomputeVerification(phone);
  return {location: v?.location ?? "not_started", status: v?.status ?? "action_required"};
});

// ── Manual documents ────────────────────────────────────────────────────────
// The images are uploaded by the app to the existing identity-document folders
// (storage.rules: driverLicenses/, selfies/, addressProofs/) and recorded on
// users/{phone}. This call snapshots the CURRENT paths into the review record, so
// what staff approve is exactly what was submitted.
const ownPath = (p: unknown, folder: string, phone: string) =>
  typeof p === "string" && p.startsWith(`${folder}/${phone}/`);

export const submitVerificationDocuments = onCall(async (request) => {
  const phone = callerPhone(request);
  const target = request.data?.target;
  if (target !== "identity" && target !== "address") throw new HttpsError("invalid-argument", "target must be identity or address.");
  const user = await requireOnboardedUser(phone);
  const now = nowIso();

  if (target === "identity") {
    const lic = user.driverLicense;
    const selfie = user.selfie;
    if (!ownPath(lic?.frontPath, "driverLicenses", phone) || !ownPath(lic?.backPath, "driverLicenses", phone) ||
        !ownPath(selfie?.frontPath, "selfies", phone)) {
      throw new HttpsError("failed-precondition", "Upload both sides of your licence and a selfie first.");
    }
    const k: any = (await kycRef(phone).get()).data();
    if (!currentVerificationRecords(k, user).identityOpen &&
        (k?.didit?.status === "Approved" || k?.identityReview?.status === "approved")) {
      throw new HttpsError("failed-precondition", "already_verified");
    }
    await spendDailyBudget(phone, "submissions", MAX_SUBMISSIONS_PER_DAY, "uploads");
    await kycRef(phone).update({
      identityReview: {status: "submitted", submittedAt: now, licenseFront: lic.frontPath, licenseBack: lic.backPath, selfie: selfie.frontPath},
      updatedAt: now,
    });
  } else {
    const proof = user.addressProof;
    if (!ownPath(proof?.frontPath, "addressProofs", phone)) {
      throw new HttpsError("failed-precondition", "Upload a proof of address first.");
    }
    await spendDailyBudget(phone, "submissions", MAX_SUBMISSIONS_PER_DAY, "uploads");
    await kycRef(phone).update({
      addressReview: {status: "submitted", submittedAt: now, forAddress: addressKey(user), document: proof.frontPath},
      updatedAt: now,
    });
  }
  const v = await recomputeVerification(phone);
  return {verification: v};
});

// ── The manual document process, as a fallback ─────────────────────────────
// Before this module, staff verified customers by eyeballing the licence, proof
// of address and selfie on users/{phone} (FoodyzzHQ order card, admin console
// Licenses tab) and stamping `reviewedAt` / `rejectedReason` on them directly.
// That process stays, and now counts: its uploads, approvals and rejections are
// mirrored into customerKyc here, so a staff-approved licence verifies identity and
// a staff-approved proof of address verifies the CURRENT delivery address. Location
// is not something documents can prove; it still needs the GPS check or an override.
//
// Trustworthy because firestore.rules only lets staff set a non-null reviewedAt.
// Called from onUserWriteLifecycleEmails (users/{phone} is too hot for a second
// trigger); plain field comparisons come first so ordinary writes do no I/O.
export async function syncDocumentReviews(phone: string, before: any, after: any): Promise<void> {
  const lic = after?.driverLicense;
  const poa = after?.addressProof;
  const was = (k: string, f: string) => before?.[k]?.[f] ?? null;
  const licApproved = !!lic?.frontPath && !!lic?.backPath && !!lic?.reviewedAt && lic.reviewedAt !== was("driverLicense", "reviewedAt");
  const poaApproved = !!poa?.frontPath && !!poa?.reviewedAt && poa.reviewedAt !== was("addressProof", "reviewedAt");
  const licRejected = !!lic?.rejectedReason && lic.rejectedReason !== was("driverLicense", "rejectedReason");
  const poaRejected = !!poa?.rejectedReason && poa.rejectedReason !== was("addressProof", "rejectedReason");
  const licUploaded = !!lic?.frontPath && !!lic?.backPath && !lic.reviewedAt && !lic.rejectedReason &&
    lic.uploadedAt !== was("driverLicense", "uploadedAt");
  const poaUploaded = !!poa?.frontPath && !poa.reviewedAt && !poa.rejectedReason && poa.uploadedAt !== was("addressProof", "uploadedAt");
  if (!licApproved && !poaApproved && !licRejected && !poaRejected && !licUploaded && !poaUploaded) return;

  const kSnap = await kycRef(phone).get();
  const k: any = kSnap.data() ?? {};
  const key = addressKey(after);
  const now = nowIso();
  const upd: Record<string, unknown> = {};
  // Through the filter, so a staff re-request reaches this path too: a customer who
  // answers it from Account -> Identity documents rather than the Verification
  // screen must still count, and the record it retired must not suppress them.
  const rec = currentVerificationRecords(k, after);
  const identityDone = rec.didit?.status === "Approved" || rec.identityReview?.status === "approved";
  const sameIdentity = (r: any) => r?.licenseFront === lic?.frontPath && r?.licenseBack === lic?.backPath;
  const addrCurrent = rec.addressReview;

  if (licApproved && !(rec.identityReview?.status === "approved" && sameIdentity(rec.identityReview))) {
    upd.identityReview = compact({
      status: "approved", source: "documents", licenseFront: lic.frontPath, licenseBack: lic.backPath,
      selfie: after.selfie?.frontPath, reviewedBy: String(lic.reviewedBy || "staff"), reviewedAt: String(lic.reviewedAt),
    });
  } else if (licRejected && !identityDone) {
    upd.identityReview = compact({
      status: "rejected", source: "documents", licenseFront: lic.frontPath, licenseBack: lic.backPath,
      selfie: after.selfie?.frontPath, note: String(lic.rejectedReason).slice(0, 500), reviewedAt: now,
    });
  } else if (licUploaded && !identityDone) {
    upd.identityReview = compact({
      status: "submitted", source: "documents", submittedAt: now, licenseFront: lic.frontPath, licenseBack: lic.backPath,
      selfie: after.selfie?.frontPath,
    });
  }

  if (poaApproved && !(addrCurrent?.status === "approved" && addrCurrent.document === poa.frontPath)) {
    upd.addressReview = {
      status: "approved", source: "documents", forAddress: key, document: poa.frontPath,
      reviewedBy: String(poa.reviewedBy || "staff"), reviewedAt: String(poa.reviewedAt),
    };
  } else if (poaRejected && addrCurrent?.status !== "approved") {
    upd.addressReview = {status: "rejected", source: "documents", forAddress: key, document: poa.frontPath,
      note: String(poa.rejectedReason).slice(0, 500), reviewedAt: now};
  } else if (poaUploaded && addrCurrent?.status !== "approved") {
    upd.addressReview = {status: "submitted", source: "documents", forAddress: key, document: poa.frontPath, submittedAt: now};
  }

  if (!Object.keys(upd).length) return;
  // update() replaces each review map whole — a merge would carry an earlier
  // record's note or submittedAt into the new one.
  if (kSnap.exists) await kycRef(phone).update({...upd, updatedAt: now});
  else await kycRef(phone).set({phone, createdAt: now, ...upd, updatedAt: now});
  // notifyDocsRejected already told the customer about a staff rejection.
  await recomputeVerification(phone, {quietRejections: licRejected || poaRejected});
}

// ── Staff ───────────────────────────────────────────────────────────────────

/** Everything a reviewer needs for one customer, including the Didit portrait inline. */
export const adminGetCustomerVerification = onCall(async (request) => {
  assertStaff(request);
  const phone = phoneArg(request.data);
  const [kSnap, uSnap, cfg] = await Promise.all([kycRef(phone).get(), userRef(phone).get(), verificationConfig(phone)]);
  const user: any = uSnap.data();
  if (!user) throw new HttpsError("not-found", "Customer not found.");
  const k: any = kSnap.data() ?? {};
  let portrait: string | null = null;
  if (k.didit?.portraitPath) {
    // Inline rather than a signed URL: no IAM signBlob grant needed, and the image
    // (a few hundred KB) never gets a shareable link.
    portrait = await kycFiles.download(String(k.didit.portraitPath))
      .then((b) => `data:image/jpeg;base64,${b.toString("base64")}`)
      .catch(() => null);
  }
  const {limits: _limits, ...kyc} = k;
  return {
    phone,
    verification: deriveVerification(k, user, cfg.radiusMiles),
    radiusMiles: cfg.radiusMiles,
    required: cfg.required,
    currentAddress: addressKey(user),
    kyc,
    portrait,
  };
});

/**
 * A staff verdict on one check.
 *   identity — approves or rejects the uploaded licence + selfie (the manual path).
 *   address  — approves or rejects the proof of address; approving with no upload
 *              is allowed for when the licence itself shows the delivery address.
 *   location — overrides a failed or doubtful location check, or rejects it so the
 *              customer has to redo it from the address.
 */
export const adminReviewCustomerVerification = onCall(async (request) => {
  const reviewedBy = assertStaff(request);
  const phone = phoneArg(request.data);
  const {target, decision} = request.data ?? {};
  const note = request.data?.note != null ? String(request.data.note).trim().slice(0, 500) || undefined : undefined;
  if (!["identity", "address", "location"].includes(target)) throw new HttpsError("invalid-argument", "Unknown target.");
  if (decision !== "approved" && decision !== "rejected") throw new HttpsError("invalid-argument", "decision must be approved or rejected.");

  const [kSnap, uSnap] = await Promise.all([kycRef(phone).get(), userRef(phone).get()]);
  const user: any = uSnap.data();
  const k: any = kSnap.data();
  if (!user || !k) throw new HttpsError("not-found", "This customer has not started verification.");
  const now = nowIso();
  const verdict = compact({status: decision, reviewedBy, reviewedAt: now, note});

  if (target === "identity") {
    const r = k.identityReview;
    if (!r?.licenseFront) throw new HttpsError("failed-precondition", "No licence and selfie were submitted for review.");
    await kycRef(phone).update({identityReview: {...r, ...verdict}, updatedAt: now});
    // Keep the per-order document flow in step: the same images count as reviewed
    // there, but only while the profile still points at what was approved.
    if (decision === "approved") {
      const stamp = {reviewedAt: now, reviewedBy, rejectedReason: null};
      const upd: Record<string, unknown> = {};
      if (user.driverLicense?.frontPath === r.licenseFront) upd.driverLicense = {...user.driverLicense, ...stamp};
      if (user.selfie?.frontPath === r.selfie) upd.selfie = {...user.selfie, ...stamp};
      if (Object.keys(upd).length) await userRef(phone).update(upd);
    }
  } else if (target === "address") {
    const r = k.addressReview?.forAddress === addressKey(user) ? k.addressReview : null;
    if (decision === "rejected" && !r?.document) throw new HttpsError("failed-precondition", "No proof of address was submitted.");
    await kycRef(phone).update({
      addressReview: {...(r ?? {source: "staff"}), ...verdict, forAddress: addressKey(user)},
      updatedAt: now,
    });
    if (decision === "approved" && r?.document && user.addressProof?.frontPath === r.document) {
      await userRef(phone).update({addressProof: {...user.addressProof, reviewedAt: now, reviewedBy, rejectedReason: null}});
    }
  } else {
    await kycRef(phone).update({locationReview: {...verdict, forAddress: addressKey(user)}, updatedAt: now});
  }
  const v = await recomputeVerification(phone);
  return {verification: v};
});

/**
 * Staff ask a customer to (re)do one check.
 *
 * The admin console's rental cards call this: there the operator is looking at an
 * order, not at a customer, and needs to put the ID check or a proof of address
 * back in front of the renter without leaving the rental. It only ASKS — the
 * decision still happens where it always has, in FoodyzzHQ / the Verification tab
 * (adminReviewCustomerVerification).
 *
 * The customer app needs no change: currentVerificationRecords retires whatever is
 * on file, so the Verification screen comes back with "Start ID check" or the
 * proof-of-address upload already open, and the push lands them on Account.
 */
export const adminRequestCustomerVerification = onCall(async (request) => {
  const requestedBy = assertStaff(request);
  const phone = phoneArg(request.data);
  const target = request.data?.target;
  if (target !== "identity" && target !== "address") {
    throw new HttpsError("invalid-argument", "target must be identity or address.");
  }
  const note = request.data?.note != null ? String(request.data.note).trim().slice(0, 500) || undefined : undefined;
  const orderId = request.data?.orderId ? String(request.data.orderId) : undefined;

  const [kSnap, uSnap] = await Promise.all([kycRef(phone).get(), userRef(phone).get()]);
  if (!uSnap.exists) throw new HttpsError("not-found", "Customer not found.");
  const now = nowIso();
  const record = compact({requestedAt: now, requestedBy, note, orderId});

  if (kSnap.exists) await kycRef(phone).update({[`requests.${target}`]: record, updatedAt: now});
  else await kycRef(phone).set({phone, createdAt: now, requests: {[target]: record}, updatedAt: now});

  // Stamped on the order too, so the rental card can show what was asked for
  // without anyone opening the customer. Best-effort: the request itself is
  // already recorded, and an order that has since been deleted must not fail it.
  if (orderId) {
    await db().doc(`orders/${orderId}`).update({[`verificationRequests.${target}`]: record})
      .catch((e) => logger.warn(`adminRequestCustomerVerification: could not stamp order ${orderId}`, e));
  }

  const v = await recomputeVerification(phone);

  const [title, body] = target === "identity" ?
    ["Action needed: verify your ID",
      `${note ? `${note} ` : ""}Foodyzz needs to check your ID again before your rental. ` +
      "Open Account → Identity verification to run the ID check."] :
    ["Action needed: proof of address",
      `${note ? `${note} ` : ""}Foodyzz needs a proof of address — a utility bill, bank statement or lease ` +
      "from the last 90 days showing your name and delivery address. " +
      "Open Account → Identity verification to upload it."];
  // ID_DOCS_REQUESTED is the type the customer app deep-links to Account (App.tsx),
  // which is where both the verification card and the document card live.
  await verificationHooks.notifyCustomer(phone, title, body, "ID_DOCS_REQUESTED")
    .catch((e) => logger.error(`adminRequestCustomerVerification: push failed for ${phone}`, e));

  return {verification: v, requestedAt: now};
});
