// Confirming a customer's email address with a code, before onboarding will take
// it and before Account will change it.
//
// Two reasons it is server-side. The code has to be generated and checked
// somewhere the customer cannot read it, and the domain rule is a business rule:
// a client-side check alone would be one rebuild away from being out of date.
//
// The result lands on users/{phone}.emailVerified, which firestore.rules keeps in
// the same server-only set as `workerId` and `verification` — so a confirmed email
// means the code really was received at that address. The plain `email` field
// stays client-writable: the app writes it itself during onboarding and on a
// profile edit, after the code for it has been confirmed here.
import {onCall, HttpsError, CallableRequest} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import * as crypto from "crypto";

const db = () => getFirestore();

// Mail goes out through this hook so the module never imports index.ts back —
// the same arrangement customerVerification.ts uses for push and admin mail.
export const emailHooks = {
  sendCode: async (_to: string, _code: string, _expiresInMin: number): Promise<void> => undefined,
};
export function installEmailHooks(h: Partial<typeof emailHooks>): void {
  Object.assign(emailHooks, h);
}

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 60 * 1000;
export const MAX_SENDS_PER_DAY = 5;
export const MAX_ATTEMPTS_PER_CODE = 5;

// Gmail, Yahoo and Outlook, as customers actually hold them: hotmail.com and
// live.com ARE Outlook accounts, and Yahoo/Outlook/Hotmail each run dozens of
// country domains (yahoo.co.uk, outlook.com.au). The suffix is bounded to real
// TLD shapes so that `yahoo.some-attacker.com` is not read as Yahoo.
export const EXACT_DOMAINS = ["gmail.com", "googlemail.com"];
export const DOMAIN_FAMILIES = /^(yahoo|ymail|outlook|hotmail|live|msn)\.[a-z]{2,4}(\.[a-z]{2,3})?$/;
export const DOMAIN_MESSAGE =
  "Please use a Gmail, Yahoo or Outlook address (gmail.com, yahoo.com, outlook.com, hotmail.com…).";

/** Trimmed and lower-cased, or null if it isn't shaped like an address. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  // One @, no spaces, a dot-bearing domain. Deliberately not RFC 5322 — the code
  // is what proves the address exists.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/**
 * Whether the address is one of the accepted providers.
 * apiConfig/global.emailDomains (an array) overrides the built-in list outright,
 * and is matched exactly — an escape hatch that needs no redeploy.
 */
export function isAcceptedDomain(email: string, override?: unknown): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  if (Array.isArray(override) && override.length) {
    return override.map((d) => String(d).trim().toLowerCase()).includes(domain);
  }
  return EXACT_DOMAINS.includes(domain) || DOMAIN_FAMILIES.test(domain);
}

const ref = (phone: string) => db().doc(`emailVerifications/${phone}`);
const nowIso = () => new Date().toISOString();
const dayKey = () => new Date().toISOString().slice(0, 10);

/** Constant-time compare of the stored digest with the code just offered. */
const digest = (phone: string, email: string, code: string) =>
  crypto.createHash("sha256").update(`${phone}|${email}|${code}`).digest("hex");

function callerPhone(request: CallableRequest): string {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const phone = String(request.auth.token.phone_number || "");
  if (!/^\+\d{8,15}$/.test(phone)) throw new HttpsError("failed-precondition", "A phone number is required.");
  return phone;
}

async function acceptedDomainsOverride(): Promise<unknown> {
  const snap = await db().doc("apiConfig/global").get();
  return snap.data()?.emailDomains;
}

/** Validates the address and starts a code. Throws with text the app can show as-is. */
export const sendEmailVerificationCode = onCall(async (request) => {
  const phone = callerPhone(request);
  const email = normalizeEmail(request.data?.email);
  if (!email) throw new HttpsError("invalid-argument", "Please enter a valid email address.");
  if (!isAcceptedDomain(email, await acceptedDomainsOverride())) {
    throw new HttpsError("failed-precondition", DOMAIN_MESSAGE);
  }

  const snap = await ref(phone).get();
  const prev: any = snap.data() ?? {};
  const now = Date.now();

  // Already confirmed this exact address — nothing to send, and the caller treats
  // this as success rather than an error.
  if (prev.verifiedEmail === email) return {alreadyVerified: true, resendInSec: 0};

  const lastSent = Date.parse(String(prev.sentAt ?? ""));
  const since = now - lastSent;
  if (Number.isFinite(lastSent) && since < RESEND_COOLDOWN_MS) {
    const wait = Math.ceil((RESEND_COOLDOWN_MS - since) / 1000);
    throw new HttpsError("resource-exhausted", `Please wait ${wait}s before asking for another code.`);
  }
  const today = dayKey();
  const sends = prev.dayKey === today ? Number(prev.sends ?? 0) : 0;
  if (sends >= MAX_SENDS_PER_DAY) {
    throw new HttpsError("resource-exhausted", "Too many codes requested today. Please try again tomorrow.");
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  await ref(phone).set({
    email,
    codeHash: digest(phone, email, code),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
    sentAt: nowIso(),
    dayKey: today,
    sends: sends + 1,
    // A previous confirmation of a DIFFERENT address stays until this one lands.
    verifiedEmail: prev.verifiedEmail ?? null,
  }, {merge: true});

  await emailHooks.sendCode(email, code, Math.round(CODE_TTL_MS / 60000));
  return {alreadyVerified: false, resendInSec: Math.round(RESEND_COOLDOWN_MS / 1000)};
});

/** Checks the code and stamps users/{phone}.emailVerified. */
export const confirmEmailVerificationCode = onCall(async (request) => {
  const phone = callerPhone(request);
  const email = normalizeEmail(request.data?.email);
  const code = String(request.data?.code ?? "").trim();
  if (!email) throw new HttpsError("invalid-argument", "Please enter a valid email address.");
  if (!/^\d{6}$/.test(code)) throw new HttpsError("invalid-argument", "Enter the 6-digit code from your email.");

  // One transaction, so a wrong guess always costs an attempt: reading the count,
  // comparing and writing it back separately would let parallel guesses all spend
  // the same attempt and slip the limit. Failures are returned, not thrown — a
  // throw would roll the increment back with it.
  type Outcome =
    | {kind: "ok"}
    | {kind: "wrong"; left: number}
    | {kind: "stop"; code: "failed-precondition" | "resource-exhausted"; message: string};

  const outcome = await db().runTransaction<Outcome>(async (tx) => {
    const rec: any = (await tx.get(ref(phone))).data();
    if (rec?.verifiedEmail === email) return {kind: "ok"};
    if (!rec?.codeHash || rec.email !== email) {
      return {kind: "stop", code: "failed-precondition", message: "Ask for a new code first."};
    }
    if (Date.parse(String(rec.expiresAt ?? "")) < Date.now()) {
      return {kind: "stop", code: "failed-precondition", message: "That code has expired. Ask for a new one."};
    }
    const attempts = Number(rec.attempts ?? 0);
    if (attempts >= MAX_ATTEMPTS_PER_CODE) {
      return {kind: "stop", code: "resource-exhausted", message: "Too many wrong codes. Ask for a new one."};
    }

    const offered = digest(phone, email, code);
    const stored = String(rec.codeHash);
    const ok = offered.length === stored.length &&
      crypto.timingSafeEqual(Buffer.from(offered), Buffer.from(stored));
    if (!ok) {
      tx.update(ref(phone), {attempts: attempts + 1});
      return {kind: "wrong", left: MAX_ATTEMPTS_PER_CODE - attempts - 1};
    }

    const verifiedAt = nowIso();
    // The code is spent, and the stamp is what the app and the rules read. Both
    // docs move together so the profile can never disagree with the record.
    tx.set(ref(phone), {verifiedEmail: email, verifiedAt, codeHash: null, attempts: 0}, {merge: true});
    tx.set(db().doc(`users/${phone}`), {emailVerified: {email, verifiedAt}}, {merge: true});
    return {kind: "ok"};
  });

  if (outcome.kind === "stop") throw new HttpsError(outcome.code, outcome.message);
  if (outcome.kind === "wrong") {
    throw new HttpsError("invalid-argument", outcome.left > 0 ?
      `That code is not right. ${outcome.left} ${outcome.left === 1 ? "try" : "tries"} left.` :
      "That code is not right.");
  }
  return {verified: true};
});
