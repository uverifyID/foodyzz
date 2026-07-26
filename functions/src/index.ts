import {onCall, onRequest, HttpsError} from "firebase-functions/v2/https";
import {onDocumentCreated, onDocumentUpdated, onDocumentWritten} from "firebase-functions/v2/firestore";
import {getFirestore, FieldValue, FieldPath, Timestamp, type DocumentReference, type QueryDocumentSnapshot} from "firebase-admin/firestore";
import {getAuth} from "firebase-admin/auth";
import {onSchedule} from "firebase-functions/v2/scheduler";
import {initializeApp} from "firebase-admin/app";
import {
  RentalOrder,
  GlobalConfig,
  SupportMessage,
  ProviderPerformance,
  OrderStatus,
  RentToBuyPlan,
  BillingSchedule,
} from "./types";
import Stripe from "stripe";
import * as nodemailer from "nodemailer";
import * as path from "path";
import * as fs from "fs";
import {setGlobalOptions} from "firebase-functions/v2";

initializeApp();
const db = getFirestore();
setGlobalOptions({maxInstances: 50, region: "us-central1"});

// ── Cached singletons (reused across warm invocations) ─────────────────────
// Both the Stripe client and the global config were previously re-created /
// re-read on every callable invocation. Caching them at module scope removes a
// Firestore read per call and avoids rebuilding the Stripe client each time,
// while a short TTL keeps admin config edits (commission/fees/keys) propagating
// quickly. A cold instance always reads fresh.
let stripe: Stripe | null = null;
let stripeKey: string | null = null;

function getStripe(secretKey: string): Stripe {
  if (!stripe || stripeKey !== secretKey) {
    stripe = new Stripe(secretKey, {apiVersion: "2024-04-10"});
    stripeKey = secretKey;
  }
  return stripe;
}

// A stored stripeCustomerId may belong to a DIFFERENT Stripe mode — e.g. a
// test-mode "cus_..." lingering in Firestore after switching to live keys.
// Reusing it against the current-mode API throws resource_missing. Verify it
// exists in the CURRENT mode; return "" if it doesn't so callers transparently
// create a fresh customer instead of crashing.
async function verifyCustomerId(stripe: Stripe, customerId: string): Promise<string> {
  if (!customerId) return "";
  try {
    const c = await stripe.customers.retrieve(customerId);
    return (c as any)?.deleted ? "" : customerId;
  } catch (e: any) {
    if (e?.code === "resource_missing") return "";
    throw e;
  }
}

const CONFIG_TTL_MS = 60_000;
let configCache: { data: GlobalConfig; at: number } | null = null;

async function getConfig(): Promise<GlobalConfig> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_TTL_MS) return configCache.data;
  // Public config (client-readable) + server-only Stripe secrets kept in a
  // separate doc that Firestore rules deny to every client. Functions use the
  // admin SDK (which bypasses rules), so they read and merge both.
  const [snap, secretSnap] = await Promise.all([
    db.doc("apiConfig/global").get(),
    db.doc("apiConfigSecret/stripe").get(),
  ]);
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "System configuration missing.");
  }
  const data = snap.data() as GlobalConfig;
  // Merge server-only secrets over the public doc. Falls back to any values still
  // inline on apiConfig/global, so this is safe to deploy BEFORE migrating data.
  const secret: any = (secretSnap.exists ? secretSnap.data() : undefined) ?? {};
  data.stripe = {
    ...data.stripe,
    ...(secret.secretKey ? {secretKey: secret.secretKey} : {}),
    ...(secret.webSecret ? {webSecret: secret.webSecret} : {}),
  };
  configCache = {data, at: now};
  return data;
}

const ZIP_COORDS: Record<string, { lat: number; lng: number }> = {
  "10025": {lat: 40.7980, lng: -73.9680},
  "10027": {lat: 40.8120, lng: -73.9610},
  "10026": {lat: 40.8020, lng: -73.9520},
  "10024": {lat: 40.7890, lng: -73.9740},
  "10023": {lat: 40.7750, lng: -73.9820},
  "10029": {lat: 40.7910, lng: -73.9440},
  "10011": {lat: 40.7410, lng: -74.0000},
  "10012": {lat: 40.7250, lng: -73.9960},
};

const PROXIMITY_THRESHOLD_AT_LOCATION_MILES = 0.1;

const getCoordsFromAddress = (address: string) => {
  const zipMatch = address.match(/\d{5}/);
  const zip = zipMatch ? zipMatch[0] : "10025";
  const getZipCoords = (zipStr: string) => {
    const cleanZip = zipStr.trim();
    if (ZIP_COORDS[cleanZip]) return ZIP_COORDS[cleanZip];
    const num = parseInt(cleanZip.replace(/\D/g, "")) || 10025;
    const lat = 40.7 + ((num % 1000) / 1000) * 0.15;
    const lng = -74.0 + (((num * 3) % 1000) / 1000) * 0.12;
    return {lat, lng};
  };
  return getZipCoords(zip);
};

const calculateDistance = (z1: string, z2: string): number => {
  const getCoords = (val: string) => {
    if (val.includes(",")) {
      const parts = val.split(",");
      return {lat: parseFloat(parts[0]), lng: parseFloat(parts[1])};
    }
    return ZIP_COORDS[val] || {lat: 40.7980, lng: -73.9680};
  };
  if (z1 === z2) return 0.5;
  const c1 = getCoords(z1);
  const c2 = getCoords(z2);
  const dLat = ((c2.lat - c1.lat) * Math.PI) / 180;
  const dLng = ((c2.lng - c1.lng) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(c1.lat * Math.PI / 180) * Math.cos(c2.lat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return parseFloat((3955.0 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(1));
};

// Fallback broadcast reach (miles) for legacy orders created before the customer's
// chosen radius (broadcastRadius) was stored on the order.
const DEFAULT_BROADCAST_RADIUS = 25;

// Days after a rental completes before the deposit obligation is cleared. The gap
// exists so damage found during inspection can still be charged.
const DEPOSIT_RELEASE_DELAY_DAYS = 2;

// ── Expo push delivery ──────────────────────────────────────────────────────
// The mobile apps register Expo push tokens (ExponentPushToken[...]) on login,
// so notifications are delivered through Expo's push service, which relays to
// APNs/FCM. Sending these tokens straight to firebase-admin messaging fails.
const EXPO_PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPT_ENDPOINT = "https://exp.host/--/api/v2/push/getReceipts";

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  // Notification sound key (e.g. 'doorbell'). Resolved per-platform in sendExpoPush:
  // iOS plays '<name>.caf' bundled in the app; Android routes via the matching
  // 'order_<name>' channel (the channel carries the sound on Android 8+).
  //   undefined → Expo default sound (admin/support/bulk legacy behavior)
  //   null      → silent (recipient turned sound off)
  //   string    → custom bundled sound
  soundName?: string | null;
  // App-icon badge number (APNs/Expo `badge`). The recipient's running unread
  // count, so the icon reminds them while the app is closed. Omit to leave the
  // badge untouched.
  badge?: number;
  // The Firestore doc holding this token. When Expo reports the device is no
  // longer registered, we clear `fcmToken` from this doc so we stop sending to
  // a dead token. Bookkeeping only — never sent to Expo.
  ref?: DocumentReference;
};

// Valid custom sound keys (must match the bundled .caf/.mp3 files and the
// Android channels created in each app). Anything else falls back to 'bell'.
const SOUND_KEYS = ["bell", "confirmation", "doorbell", "happybell", "officering", "oldphone", "quicktone", "vintage"];

// Provider's chosen sound, synced from the app to providers/{id}. Returns null
// when the provider turned notification sound off. Used for the DISPATCH (new-order)
// alert, which keeps the provider's own picked sound.
function providerSoundName(data: any): string | null {
  if (data?.notificationSoundEnabled === false) return null;
  const sel = data?.notificationSound;
  return typeof sel === "string" && SOUND_KEYS.includes(sel) ? sel : "bell";
}

// Only the new-order dispatch alert keeps the provider's chosen sound; every other
// provider notification uses the standard quicktone alert.
const DISPATCH_SOUND_TYPES = new Set(["BROADCAST_ORDER", "DIRECT_ORDER"]);
function providerSoundForType(data: any, type: string): string | null {
  if (data?.notificationSoundEnabled === false) return null;
  return DISPATCH_SOUND_TYPES.has(type) ? providerSoundName(data) : "quicktone";
}

// Customers have no sound picker — only an on/off toggle. Quicktone is the standard
// alert for every customer notification (mirrors the customer app's foreground sound).
function customerSoundName(data: any): string | null {
  if (data?.notificationSoundEnabled === false) return null;
  return "quicktone";
}

function isExpoToken(token: unknown): token is string {
  return typeof token === "string" && token.startsWith("ExponentPushToken[");
}

// Removes stale fcmToken fields from docs whose tokens Expo rejected. Dedupes
// by path and never throws — token cleanup is best-effort.
async function clearDeadTokens(refs: DocumentReference[]): Promise<void> {
  const unique = new Map<string, DocumentReference>();
  refs.forEach((r) => unique.set(r.path, r));
  await Promise.all([...unique.values()].map(async (ref) => {
    try {
      await ref.update({fcmToken: FieldValue.delete()});
    } catch (err) {
      console.error(`Failed to clear dead token at ${ref.path}:`, err);
    }
  }));
}

// App-icon badge: a running per-recipient unread count. Bumps `badgeCount` on
// the recipient doc and returns the new value to send as the push `badge`, so
// the icon reminds the user even while the app is killed; the app resets it to
// 0 on open. The stored write is atomic (increment); the returned number uses
// the freshly-read value + 1 — a rare concurrent send may under/overcount by
// one, which is invisible and self-heals on the next open. Best-effort write.
function bumpBadge(ref: DocumentReference, data: any): number {
  ref.update({badgeCount: FieldValue.increment(1)}).catch((err) =>
    console.error(`Failed to bump badge at ${ref.path}:`, err));
  return (typeof data?.badgeCount === "number" ? data.badgeCount : 0) + 1;
}

// Sends Expo push messages in chunks of 100 (Expo's per-request limit) and
// returns the count of accepted tickets. Invalid/non-Expo tokens are skipped;
// tokens Expo reports as DeviceNotRegistered are cleared from Firestore.
async function sendExpoPush(messages: ExpoMessage[], outTickets?: Array<{ id: string; ref?: DocumentReference }>): Promise<number> {
  const valid = messages.filter((m) => isExpoToken(m.to));
  if (valid.length === 0) return 0;
  let sent = 0;
  for (let i = 0; i < valid.length; i += 100) {
    const chunk = valid.slice(i, i + 100);
    // Strip `ref` (and any other bookkeeping) before sending to Expo, and resolve
    // the sound per-platform: iOS gets the bundled .caf via the STRING `sound`
    // (the `{name,critical,volume}` object form is reserved for Critical Alerts,
    // which need the com.apple.developer.usernotifications.critical-alerts
    // entitlement — without it iOS silently drops the sound); Android gets the
    // matching custom channel via `channelId` (the channel owns the sound on
    // Android 8+, so `sound` there is moot but harmless).
    const payload = chunk.map((m) => {
      const msg: Record<string, unknown> = {
        to: m.to,
        title: m.title,
        body: m.body,
        data: m.data,
      };
      if (typeof m.badge === "number") msg.badge = m.badge;
      if (m.soundName === null) {
        msg.sound = null; // iOS: silent
        msg.channelId = "order_silent"; // Android: route to the no-sound channel
      } else if (m.soundName) {
        msg.sound = `${m.soundName}.caf`; // iOS: bundled custom sound (string form)
        msg.channelId = `order_${m.soundName}`;
      } else {
        msg.sound = "default"; // legacy default (admin/support/bulk)
      }
      return msg;
    });
    try {
      const res = await fetch(EXPO_PUSH_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Accept-Encoding": "gzip, deflate",
        },
        body: JSON.stringify(payload),
      });
      const json: any = await res.json();
      // Tickets come back in the same order as the messages sent.
      const tickets: any[] = json?.data ?? [];
      const deadRefs: DocumentReference[] = [];
      tickets.forEach((t, idx) => {
        if (t?.status === "ok") {
          sent++;
          // Pair each ticket id with its recipient doc so a caller can poll receipts
          // for the TRUE delivery result — a ticket is only "accepted by Expo", not
          // "delivered to device" — and attribute the outcome to a specific user.
          if (outTickets && t.id) outTickets.push({id: t.id, ref: chunk[idx].ref});
          return;
        }
        if (t?.details?.error === "DeviceNotRegistered" && chunk[idx]?.ref) {
          deadRefs.push(chunk[idx].ref!);
        }
      });
      const failed = tickets.filter((t) => t?.status === "error");
      if (failed.length) console.error("Expo push ticket errors:", failed);
      if (json?.errors) console.error("Expo push request errors:", json.errors);
      if (deadRefs.length) await clearDeadTokens(deadRefs);
    } catch (err) {
      console.error("Expo push request failed:", err);
    }
  }
  return sent;
}

// Polls Expo for push RECEIPTS — the TRUE per-message delivery result. The send
// step only yields "accepted" tickets; the receipt says whether APNs/FCM actually
// took it. Errors are tallied by code so a caller can see WHY a device stayed
// silent: 'DeviceNotRegistered' (stale token / app uninstalled / wrong project),
// 'InvalidCredentials'/'MismatchSenderId' (the app's EAS push credentials), etc.
// Best-effort; never throws. Receipts may lag a few seconds — unresolved ids are
// reported as "pending".
async function fetchExpoReceipts(ticketIds: string[]): Promise<Map<string, { status: string; error: string | null; message: string | null }>> {
  const map = new Map<string, { status: string; error: string | null; message: string | null }>();
  for (let i = 0; i < ticketIds.length; i += 1000) {
    const ids = ticketIds.slice(i, i + 1000);
    try {
      const res = await fetch(EXPO_RECEIPT_ENDPOINT, {
        method: "POST",
        headers: {"Content-Type": "application/json", "Accept": "application/json"},
        body: JSON.stringify({ids}),
      });
      const json: any = await res.json();
      const receipts: Record<string, any> = json?.data ?? {};
      for (const id of ids) {
        const r = receipts[id];
        if (!r) continue; // not ready yet → left unresolved (pending)
        map.set(id, {status: r.status, error: r?.details?.error ?? null, message: r.message ?? null});
      }
      if (json?.errors) console.error("Expo getReceipts request errors:", json.errors);
    } catch (err) {
      console.error("Expo getReceipts failed:", err);
    }
  }
  return map;
}

async function notifyCustomer(phoneNumber: string, orderId: string, title: string, body: string, type: string) {
  if (!phoneNumber || phoneNumber === "anonymous") return;
  try {
    const userRef = db.collection("users").doc(phoneNumber);
    const userSnap = await userRef.get();
    const userData = userSnap.data();
    const fcmToken = userData?.fcmToken;
    if (fcmToken) {
      await sendExpoPush([{
        to: fcmToken,
        title,
        body,
        soundName: customerSoundName(userData),
        badge: bumpBadge(userRef, userData),
        data: {orderId, type, timestamp: Timestamp.now().toMillis().toString()},
        ref: userRef,
      }]);
    }
  } catch (error) {
    console.error("Customer Notification Error:", error);
  }
}

async function notifyAdmin(title: string, body: string, type: string, data?: Record<string, string>) {
  try {
    const adminUsersSnap = await db.collection("users").where("isAdmin", "==", true).get();
    const messages: ExpoMessage[] = [];
    adminUsersSnap.forEach((doc) => {
      const fcmToken = doc.data()?.fcmToken;
      if (fcmToken) messages.push({to: fcmToken, title, body, data: {type, ...data}, ref: doc.ref});
    });
    await sendExpoPush(messages);
  } catch (error) {
    console.error("Admin Notification Error:", error);
  }
}

async function notifyProvider(providerId: string, title: string, body: string, type: string, orderId?: string, promoId?: string) {
  if (!providerId) return;
  try {
    const providerRef = db.collection("providers").doc(providerId);
    const providerSnap = await providerRef.get();
    const providerData = providerSnap.data();
    const fcmToken = providerData?.fcmToken;
    if (fcmToken) {
      await sendExpoPush([{
        to: fcmToken,
        title,
        body,
        soundName: providerSoundForType(providerData, type),
        badge: bumpBadge(providerRef, providerData),
        data: {type, ...(orderId && {orderId}), ...(promoId && {promoId}), timestamp: Timestamp.now().toMillis().toString()},
        ref: providerRef,
      }]);
    }
  } catch (error) {
    console.error("Provider Notification Error:", error);
  }
}

async function notifySupportUser(userPhone: string, userRole: "customer" | "provider", title: string, body: string, type: string, messageId: string) {
  try {
    let fcmToken: string | undefined;
    let ref: DocumentReference | undefined;
    let refData: any;
    let soundName: string | null = "quicktone";
    if (userRole === "customer") {
      ref = db.collection("users").doc(userPhone);
      const userSnap = await ref.get();
      refData = userSnap.data();
      fcmToken = refData?.fcmToken;
      soundName = customerSoundName(refData);
    } else if (userRole === "provider") {
      // providers.phoneNumber is stored DIGITS-ONLY (e.g. "15551234567"), but a
      // support message's userPhone comes from auth as E.164 ("+15551234567").
      // Query on the digits form (falling back to the raw value for any legacy doc
      // that stored the "+") so the provider lookup actually matches — otherwise the
      // token is never found and the provider gets no support-reply notification.
      const digitsPhone = userPhone.replace(/\D/g, "");
      let snap = await db.collection("providers").where("phoneNumber", "==", digitsPhone).get();
      if (snap.empty && digitsPhone !== userPhone) {
        snap = await db.collection("providers").where("phoneNumber", "==", userPhone).get();
      }
      if (!snap.empty) {
        refData = snap.docs[0].data();
        fcmToken = refData?.fcmToken;
        soundName = providerSoundForType(refData, type);
        ref = snap.docs[0].ref;
      }
    }

    if (fcmToken) {
      await sendExpoPush([{
        to: fcmToken,
        title,
        body,
        soundName,
        ...(ref ? {badge: bumpBadge(ref, refData)} : {}),
        data: {userPhone, type, messageId, timestamp: Timestamp.now().toMillis().toString()},
        ref,
      }]);
    }
  } catch (error) {
    // Mask the phone in logs — last 4 digits are enough to correlate without storing PII.
    const maskedPhone = userPhone ? `…${String(userPhone).slice(-4)}` : "unknown";
    console.error(`Notification Error for ${userRole} ${maskedPhone}:`, error);
  }
}

// ── Canonical pricing ───────────────────────────────────────────────────────
// Single source of truth for order pricing, mirrored by the customer app for
// display. `subtotalInclCommission` is the base service price already marked up
// by the commission rate (e.g. $10 → $11.50 at 15%). Tax applies to the
// subtotal ONLY — neither the platform fee nor delivery is taxed. `taxRate` is
// the provider's self-declared sales-tax rate (0 when they don't charge tax).
// The CC processing fee covers everything Stripe touches (subtotal + platformFee
// + delivery + tax).
interface Pricing {
  subtotal: number;
  platformFee: number;
  taxRate: number;
  tax: number;
  deliveryFee: number;
  prioritySurcharge: number;
  ccFee: number;
  total: number;
}

// Stripe rejects a PaymentIntent below $0.50. A heavy coupon (Option B charges only
// the residual tax + processing fee) can drop the total under that floor, so any hold
// is clamped up to this minimum — otherwise PI creation throws and checkout fails.
const MIN_STRIPE_CHARGE_CENTS = 50;
const chargeCentsFor = (totalDollars: number): number =>
  Math.max(Math.round((totalDollars || 0) * 100), MIN_STRIPE_CHARGE_CENTS);

// One rent-to-buy billing interval forward from an ISO timestamp, honoring the model's
// configured cadence. Month math uses setMonth so a Jan-31 start lands correctly.
// 'daily'/'weekly' are testing conveniences; 'monthly' is the production default.
const normCadence = (c: any): "daily" | "weekly" | "monthly" =>
  c === "daily" || c === "weekly" ? c : "monthly";
const advanceByCadence = (iso: string, cadence: string): string => {
  const d = new Date(iso);
  if (cadence === "daily") d.setDate(d.getDate() + 1);
  else if (cadence === "weekly") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
};
const addDaysIso = (iso: string, n: number): string => {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

function computePricing(
  subtotalInclCommission: number,
  taxRate: number,
  config: GlobalConfig,
  couponDiscount = 0,
): Pricing {
  const isPickupDelivery = false; // delivery is bundled into the rental rate
  const prioritySurcharge = 0; // rentals have no rush tier
  const subtotal = subtotalInclCommission;
  // Foodyzz owns the fleet and is the merchant of record, so there is no commission
  // and therefore no minimum-commission top-up. (This used to add up to $25 to any
  // order under that threshold — a $19.99 weekly rental was silently billed $25.)
  const platformFee = 0;

  // Sales tax is on the service subtotal only — not the platform fee, not delivery,
  // not the priority surcharge.
  const tax = subtotal * taxRate;

  const deliveryFee = isPickupDelivery ? (config.deliveryFee?.pickupDelivery ?? 0) : 0;
  const surcharge = prioritySurcharge > 0 ? prioritySurcharge : 0;
  const feeBase = subtotal + platformFee + deliveryFee + surcharge + tax;
  const ccFee = feeBase * config.stripe.processingFee + config.stripe.transactionFee;

  const total = Math.max(0, subtotal - couponDiscount) + platformFee + deliveryFee + surcharge + tax + ccFee;

  return {subtotal, platformFee, taxRate, tax, deliveryFee, prioritySurcharge: surcharge, ccFee, total};
}

// Rental pricing. Every rate, fee and minimum lives in apiConfig/logistics, so the
// server re-derives the quote from the customer's SELECTIONS rather than trusting a
// client-sent amount. Mirrors services/logistics.computeQuote in both apps.
export interface LogisticsDoc {
  bikeModels: Array<{
    model: number;
    name: string;
    rates: { rent: number; buy: number; rentToBuy: number };
    // rentToBuyCadence controls how often installments are billed. Defaults to 'monthly';
    // 'daily'/'weekly' exist so a plan can be exercised end-to-end without waiting months.
    minCommitment: { rent: number; rentToBuy: number; rentCadence?: string; rentToBuyCadence?: string };
  }>;
  fees: Array<{ key: string; label: string; amount: number; required: boolean; cadence: string; isDeposit?: boolean }>;
  restockDays?: number;
}

async function getLogistics(): Promise<LogisticsDoc> {
  const snap = await db.doc("apiConfig/logistics").get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "apiConfig/logistics is not configured.");
  }
  return snap.data() as LogisticsDoc;
}

export interface RentalQuote {
  baseRate: number;
  periods: number;
  unit: "weeks" | "months";
  recurringFees: number;
  oneTimeFees: number;
  depositAmount: number;
  // What is charged NOW. rent/buy: the whole thing. rentToBuy: the FIRST period only
  // (the rest are billed one period at a time after delivery).
  subtotal: number;
  // rentToBuy only: the recurring per-period subtotal (rate + recurring fees), used to
  // price each installment after the first. One-time fees are billed in period 1 only.
  perPeriodSubtotal?: number;
}

/**
 * Authoritative rental subtotal. The DEPOSIT is deliberately excluded — per the
 * project spec it never appears on the rental invoice; it is secured separately
 * against the customer's saved card at delivery.
 *
 * The base rate scales with the term (rate × periods); the fee bundle is charged
 * once per rental period, not per week/month.
 */
function computeRentalSubtotal(
  logistics: LogisticsDoc,
  rentalType: "rent" | "rentToBuy" | "buy",
  bikeModel: number,
  durationValue: number,
  acceptedFeeKeys: string[],
): RentalQuote {
  const model = (logistics.bikeModels || []).find((m) => m.model === Number(bikeModel));
  if (!model) throw new HttpsError("invalid-argument", `Unknown bike model ${bikeModel}.`);

  const baseRate = model.rates[rentalType];
  if (typeof baseRate !== "number" || baseRate <= 0) {
    throw new HttpsError("invalid-argument", `Model ${bikeModel} has no ${rentalType} price.`);
  }

  const unit: "weeks" | "months" = rentalType === "rentToBuy" ? "months" : "weeks";
  const deposit = (logistics.fees || []).find((f) => f.isDeposit)?.amount ?? 0;

  if (rentalType === "buy") {
    return {baseRate, periods: 1, unit, recurringFees: 0, oneTimeFees: 0, depositAmount: 0, subtotal: baseRate};
  }

  // Never let a client shorten the committed term below the configured minimum.
  // Rent-to-buy's term IS the minimum commitment (fixed, monthly); plain rent lets the
  // customer choose weeks at or above the minimum.
  const minimum = model.minCommitment[rentalType] ?? 1;
  const periods = rentalType === "rentToBuy" ?
    minimum :
    Math.max(minimum, Number(durationValue) || minimum);

  // Required fees always apply; optional ones only if the customer accepted them.
  const billable = (logistics.fees || []).filter(
    (f) => !f.isDeposit && (f.required || acceptedFeeKeys.includes(f.key)),
  );
  const recurringFees = billable.filter((f) => f.cadence !== "once").reduce((sum, f) => sum + f.amount, 0);
  const oneTimeFees = billable.filter((f) => f.cadence === "once").reduce((sum, f) => sum + f.amount, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Rent-to-buy is billed one period at a time. What is charged at delivery is a single
  // period (rate + recurring fees, plus any one-time fees on the first period only); the
  // installment cron charges `perPeriodSubtotal` each due period thereafter.
  if (rentalType === "rentToBuy") {
    return {
      baseRate,
      periods,
      unit,
      recurringFees,
      oneTimeFees,
      depositAmount: deposit,
      subtotal: round2(baseRate + recurringFees + oneTimeFees),
      perPeriodSubtotal: round2(baseRate + recurringFees),
    };
  }

  // Plain rent: the whole committed term is charged once at delivery. Fees are charged
  // once per rental period, not multiplied by the number of weeks in the term.
  const subtotal = baseRate * periods + recurringFees + oneTimeFees;
  return {
    baseRate,
    periods,
    unit,
    recurringFees,
    oneTimeFees,
    depositAmount: deposit,
    subtotal: round2(subtotal),
  };
}

export const createPaymentIntent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {
    orderId, currency, providerId, stripeCustomerId,
    // The customer's SELECTIONS. The server re-derives the price from these against
    // apiConfig/logistics — a client-sent amount is never trusted.
    rentalType, bikeModel, durationValue, fees,
  } = request.data;

  if (!providerId || providerId === "broadcast") {
    throw new HttpsError("invalid-argument", "A pickup location must be selected.");
  }
  if (!["rent", "rentToBuy", "buy"].includes(rentalType)) {
    throw new HttpsError("invalid-argument", "Invalid rental type.");
  }

  try {
    const [config, logistics] = await Promise.all([getConfig(), getLogistics()]);
    const stripe = getStripe(config.stripe.secretKey);

    if (!config.stripe?.processingFee || !config.stripe?.transactionFee) {
      throw new HttpsError("failed-precondition", "Missing required Stripe configuration.");
    }

    // Only fee keys the customer actually accepted; required fees are forced on
    // inside computeRentalSubtotal regardless of what the client sent.
    const acceptedFeeKeys: string[] = Array.isArray(fees) ?
      fees.filter((f: any) => f?.accepted).map((f: any) => String(f.key)) :
      [];

    const quote = computeRentalSubtotal(logistics, rentalType, bikeModel, durationValue, acceptedFeeKeys);

    // Sales tax is declared per FoodyzzHQ location during its onboarding
    // (providers/{id}.chargesSalesTax + salesTaxRate), since the applicable rate is
    // the one for the jurisdiction the bike is delivered from.
    const provSnap = await db.collection("providers").doc(String(providerId)).get();
    const prov = provSnap.data() || {};
    const taxRate = prov.chargesSalesTax === true ? (prov.salesTaxRate ?? 0) : 0;
    const pricing = computePricing(quote.subtotal, taxRate, config);

    // Rent-to-buy: price the recurring installment now so the amount is locked at
    // checkout. quote.subtotal already charges only the first period at delivery; each
    // later period bills `perPeriodAmount` (per-period subtotal + its own tax + card fee).
    let rentToBuyPlan: RentToBuyPlan | undefined;
    if (rentalType === "rentToBuy" && typeof quote.perPeriodSubtotal === "number") {
      const perPeriod = computePricing(quote.perPeriodSubtotal, taxRate, config);
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const rtbModel = (logistics.bikeModels || []).find((m) => m.model === Number(bikeModel));
      rentToBuyPlan = {
        periodsTotal: quote.periods,
        unit: quote.unit,
        cadence: normCadence(rtbModel?.minCommitment?.rentToBuyCadence),
        perPeriodSubtotal: quote.perPeriodSubtotal,
        perPeriodTax: round2(perPeriod.tax),
        perPeriodCcFee: round2(perPeriod.ccFee),
        perPeriodAmount: chargeCentsFor(perPeriod.total) / 100,
        taxRate,
      };
    }

    // Clamp to Stripe's $0.50 minimum and report the clamped figure, so the stored
    // and displayed amount always equals what is actually authorized.
    const chargeCents = chargeCentsFor(pricing.total);
    const chargeTotal = chargeCents / 100;

    // Ignore stale test-mode customer ids from a client that saved a card before
    // the switch to live Stripe keys.
    let verifiedCustomerId = await verifyCustomerId(stripe, stripeCustomerId || "");

    // Every rental needs a Customer attached: `setup_future_usage` below only saves
    // the card if there is somewhere to save it to. Create one on first order and
    // persist it so later charges (and the deposit hold) reuse the same record.
    const buyerPhone = request.auth.token.phone_number || "";
    if (!verifiedCustomerId && buyerPhone) {
      const userRef = db.collection("users").doc(String(buyerPhone));
      const existing = (await userRef.get()).data()?.stripeCustomerId;
      verifiedCustomerId = await verifyCustomerId(stripe, existing || "");
      if (!verifiedCustomerId) {
        const created = await stripe.customers.create({
          phone: String(buyerPhone),
          metadata: {customerPhone: String(buyerPhone)},
        });
        verifiedCustomerId = created.id;
      }
      await userRef.set({stripeCustomerId: verifiedCustomerId}, {merge: true});
    }

    // Manual capture: nothing is charged until the bike is actually delivered.
    // Idempotency key includes the amount so a retried identical request reuses
    // the same hold (no duplicate authorization on the card), while a legitimate
    // re-authorization at a different price still creates a fresh hold.
    const paymentIntent = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: String(currency || "usd").toLowerCase(),
      capture_method: "manual",
      automatic_payment_methods: {enabled: true},
      ...(verifiedCustomerId ?
        {
          customer: verifiedCustomerId,
          // Save the card by default. The deposit is authorized off-session at
          // delivery, which is only possible against a retained payment method.
          setup_future_usage: "off_session" as const,
        } :
        {}),
      metadata: {
        orderId,
        rentalType,
        bikeModel: String(bikeModel),
        term: `${quote.periods} ${quote.unit}`,
        taxAmount: pricing.tax.toFixed(2),
        fees: pricing.ccFee.toFixed(2),
      },
    }, {idempotencyKey: `${orderId}:auth:${chargeCents}`});

    return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      pricing: {
        orderSubtotal: pricing.subtotal,
        baseRate: quote.baseRate,
        durationValue: quote.periods,
        durationUnit: quote.unit,
        recurringFees: quote.recurringFees,
        oneTimeFees: quote.oneTimeFees,
        // Disclosed to the customer, but NOT part of this charge.
        depositAmount: quote.depositAmount,
        taxRate: pricing.taxRate,
        tax: pricing.tax,
        ccProcessingFee: pricing.ccFee,
        total: chargeTotal,
        // Present only for rent-to-buy — the installment plan the client persists on
        // the order so delivery can seed the billing schedule from it.
        rentToBuyPlan: rentToBuyPlan ?? null,
      },
    };
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    console.error("createPaymentIntent failed:", error);
    throw new HttpsError("internal", error?.message || "Could not start payment. Please try again.");
  }
});

export const stripeWebhook = onRequest(async (req, res) => {
  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    // Verify the event came from Stripe using your webSecret
    event = stripe.webhooks.constructEvent(
      (req as any).rawBody,
      sig!,
      config.stripe.webSecret || ""
    );
  } catch (err: any) {
    console.error(`Webhook Error: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  const intent = event.data.object as Stripe.PaymentIntent;
  const orderId = intent.metadata.orderId;

  if (!orderId) {
    res.json({received: true, info: "No orderId in metadata"});
    return;
  }

  switch (event.type) {
  case "payment_intent.amount_capturable_updated": {
    const pi = event.data.object as Stripe.PaymentIntent;
    const orderId = pi.metadata?.orderId;
    const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : "";
    const customerId = typeof pi.customer === "string" ? pi.customer : "";
    // A deposit hold must never overwrite the rental card record.
    if (orderId && paymentMethodId && pi.metadata?.kind !== "security_deposit") {
      try {
        const orderSnap = await db.collection("orders").doc(orderId).get();
        const phone = orderSnap.data()?.customerPhone;
        if (phone) {
          const card = await stripe.paymentMethods.retrieve(paymentMethodId);
          await db.collection("users").doc(String(phone)).set({
            ...(customerId ? {stripeCustomerId: customerId} : {}),
            billingPaymentMethodId: paymentMethodId,
            billingCardLast4: card.card?.last4 ?? null,
            billingCardBrand: card.card?.brand ?? null,
            billingCardExpMonth: card.card?.exp_month ?? null,
            billingCardExpYear: card.card?.exp_year ?? null,
          }, {merge: true});
        }
      } catch (err) {
        console.warn(`stripeWebhook: could not record card for ${orderId}`, err);
      }
    }
    break;
  }
  case "payment_intent.succeeded": {
    // Post-delivery tip (separate PaymentIntent) — record it onto the order WITHOUT
    // touching the base-charge fields, then notify the provider. Guard against the
    // off-session path having already recorded it.
    if (intent.metadata.tip === "true") {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await orderRef.get();
      if (orderSnap.exists) {
        const order = orderSnap.data() as RentalOrder;
        if (!(typeof order.tip === "number" && order.tip > 0)) {
          const tip = parseFloat(intent.metadata.tipAmount || "") || (intent.amount_received ?? intent.amount) / 100;
          const fullPi = await stripe.paymentIntents.retrieve(intent.id, {expand: ["latest_charge.balance_transaction"]});
          await recordTipPaid(orderRef, order, fullPi, tip);
        }
      }
      break;
    }
    // `succeeded` fires only once funds are actually CAPTURED — for manual
    // capture this is after capturePaymentIntent runs (at rental start), not
    // at authorization. So paymentCaptured is always true here.
    // NOTE: this must NOT touch payoutStatus — that is the PROVIDER-payout
    // lifecycle (set only when a Connect transfer completes), a different concern
    // from the customer charge. (The old code wrongly wrote depositStatus here.)
    const upd: Record<string, any> = {paymentCaptured: true, updatedAt: new Date().toISOString()};
    // Backstop the settlement date + charged amount from the charge's balance
    // transaction (capturePaymentIntent already stamps these; only fill, don't clobber).
    const chargeId = typeof intent.latest_charge === "string" ? intent.latest_charge : undefined;
    if (chargeId) {
      try {
        const charge = await stripe.charges.retrieve(chargeId, {expand: ["balance_transaction"]});
        upd.chargedAmount = (charge.amount_captured ?? charge.amount) / 100;
        const bt = charge.balance_transaction && typeof charge.balance_transaction !== "string" ?
            charge.balance_transaction as Stripe.BalanceTransaction : null;
        if (bt?.available_on) upd.chargeAvailableOn = new Date(bt.available_on * 1000).toISOString();
      } catch (e) {
        console.warn("stripeWebhook: charge retrieve failed (non-fatal)", e);
      }
    }
    await db.collection("orders").doc(orderId).update(upd);
    break;
  }
  case "payment_intent.payment_failed":
    await db.collection("orders").doc(orderId).update({
      status: "cancelled",
      paymentError: intent.last_payment_error?.message || "Payment failed",
      updatedAt: new Date().toISOString(),
    });
    break;
  }

  res.json({received: true});
});
export const claimOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, providerId, providerName, providerPhone} = request.data;
  if (!orderId || !providerId) throw new HttpsError("invalid-argument", "Missing details.");

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await transaction.get(orderRef);

      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
      const order = orderSnap.data() as RentalOrder;

      if (order.status !== OrderStatus.REQUESTED) {
        throw new HttpsError("failed-precondition", "Order is no longer available.");
      }

      // A rental is quoted in full at checkout from apiConfig/logistics and is never
      // re-priced on accept, so there is no settlement step and no re-authorization:
      // the amount already authorized IS the amount that will be captured on delivery.
      transaction.update(orderRef, {
        providerId,
        providerName,
        providerPhone,
        status: OrderStatus.CONFIRMED,
        confirmedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      return {customerPhone: order.customerPhone, total: order.estimatedPrice ?? 0};
    });

    if (result.customerPhone) {
      // Provider accepted at (or below) the authorized total — tell the customer
      // their order was picked up. Non-fatal: the claim already committed.
      try {
        const who = providerName ? ` by ${providerName}` : "";
        await notifyCustomer(
          result.customerPhone,
          orderId,
          "Order Accepted!",
          `Your rental ${orderId.replace("order_", "#")} was accepted${who}.`,
          "ORDER_CONFIRMED"
        );
      } catch (notifyErr) {
        console.warn("claimOrder: customer confirmation notification failed (non-fatal)", notifyErr);
      }
    }

    return {success: true};
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message);
  }
});

export const capturePaymentIntent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  try {
    const config = await getConfig();
    const stripe = getStripe(config.stripe.secretKey);
    const orderRef = db.collection("orders").doc(orderId);

    // Read the order OUTSIDE any transaction. The Stripe capture below is an
    // external side effect and must never run inside runTransaction — Firestore
    // re-runs the transaction callback on write contention, which would re-fire
    // the capture (double-charge). We capture first, then persist flags in a
    // transaction that only touches Firestore.
    const preSnap = await orderRef.get();
    if (!preSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = preSnap.data() as RentalOrder;
    if (order.paymentCaptured) return {success: true};

    // Settlement: when the captured funds become available in the platform's Stripe
    // balance (~3 days). Read from the charge's balance transaction so payouts only
    // include settled money. Captured amount comes from the charge too (source of truth).
    let chargeAvailableOn: string | undefined;
    let capturedCents: number | undefined;

    if (order.paymentIntentId) {
      let pi = await stripe.paymentIntents.retrieve(order.paymentIntentId, {expand: ["latest_charge.balance_transaction"]});

      if (pi.status === "succeeded") {
        // Already captured on Stripe's side — just reconcile our flags below.
      } else if (pi.status === "requires_capture") {
        // Capture the adjusted/estimated total, but NEVER more than the amount
        // actually authorized — Stripe rejects an over-capture, which surfaced
        // to providers as a bare "INTERNAL". A higher adjusted price should have
        // been re-authorized at customer approval; clamp here as a backstop.
        const desired = Math.round((order.finalPrice || order.estimatedPrice) * 100);
        const captureAmount = Math.min(desired, pi.amount);
        if (captureAmount < desired) {
          console.warn(`capturePaymentIntent: clamping ${orderId} capture from ${desired} to authorized ${pi.amount}`);
        }
        // Idempotency key: a retried or concurrent invocation with the same key
        // returns the original capture result instead of charging again.
        pi = await stripe.paymentIntents.capture(
          order.paymentIntentId,
          {amount_to_capture: captureAmount, expand: ["latest_charge.balance_transaction"]},
          {idempotencyKey: `${orderId}:capture`},
        );
      } else {
        // requires_payment_method / requires_confirmation / canceled — the hold
        // isn't in a capturable state. Surface a clear, non-scrubbed message.
        throw new HttpsError(
          "failed-precondition",
          `Payment can't be captured (status: ${pi.status}). The customer may need to re-confirm payment for this order.`,
        );
      }

      const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge as Stripe.Charge : null;
      if (charge) capturedCents = charge.amount_captured ?? charge.amount;
      const bt = charge && charge.balance_transaction && typeof charge.balance_transaction !== "string" ?
        charge.balance_transaction as Stripe.BalanceTransaction : null;
      if (bt?.available_on) chargeAvailableOn = new Date(bt.available_on * 1000).toISOString();
    }

    const nowIso = new Date().toISOString();
    // Fallback if Stripe hasn't produced a balance transaction yet: funds available
    // ~3 days after capture (the webhook also stamps this as a backstop).
    if (!chargeAvailableOn) chargeAvailableOn = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    const chargedAmount = typeof capturedCents === "number" ? capturedCents / 100 : (order.finalPrice ?? order.estimatedPrice);

    // Persist the capture flags. The transaction re-checks paymentCaptured so a
    // concurrent invocation that already recorded the capture doesn't double-write
    // or double-notify (the Stripe capture above is idempotency-keyed, so both
    // callers saw the same charge).
    let customerPhone: string | undefined;
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(orderRef);
      const cur = snap.data() as RentalOrder | undefined;
      if (!cur || cur.paymentCaptured) return;
      transaction.update(orderRef, {
        paymentCaptured: true,
        chargeAvailableOn,
        chargedAmount, // audit: what the customer was actually charged
        chargedAt: nowIso,
        updatedAt: nowIso,
      });
      customerPhone = cur.customerPhone;
    });

    if (customerPhone) {
      // Non-fatal: the payment is already captured and the order updated inside
      // the transaction. A notification failure (e.g. an invalid/partial phone)
      // must not bubble up as a capture failure.
      try {
        const amountText = typeof chargedAmount === "number" ? ` and you were charged $${chargedAmount.toFixed(2)}` : "";
        await notifyCustomer(
          customerPhone,
          orderId,
          "Rental Started",
          `Your bike for order ${orderId.replace("order_", "#")} has started${amountText}.`,
          "PAYMENT_CAPTURED"
        );
      } catch (notifyErr) {
        console.warn("capturePaymentIntent: customer notification failed (non-fatal)", notifyErr);
      }
    }

    return {success: true};
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    console.error("capturePaymentIntent error:", error);
    throw new HttpsError("internal", error.message);
  }
});

export const saveProviderBillingCard = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

  const {providerId, paymentMethodId, cardName} = request.data;
  if (!providerId || !paymentMethodId) {
    throw new HttpsError("invalid-argument", "Missing required fields.");
  }

  const providerSnap = await db.collection("providers").doc(providerId).get();
  if (!providerSnap.exists) throw new HttpsError("not-found", "Provider not found.");

  try {
    const config = await getConfig();
    const stripe = getStripe(config.stripe.secretKey);

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    let customerId: string = providerSnap.data()!.stripeCustomerId || "";
    // Drop stale customer ids from a previous Stripe mode so we recreate in live mode.
    customerId = await verifyCustomerId(stripe, customerId);

    if (customerId) {
      const existing = await stripe.paymentMethods.list({customer: customerId, type: "card"});
      for (const pm of existing.data) {
        await stripe.paymentMethods.detach(pm.id);
      }
      await stripe.paymentMethods.attach(paymentMethod.id, {customer: customerId});
      await stripe.customers.update(customerId, {
        name: cardName,
        invoice_settings: {default_payment_method: paymentMethod.id},
      });
    } else {
      const customer = await stripe.customers.create({
        name: cardName,
        payment_method: paymentMethod.id,
        invoice_settings: {default_payment_method: paymentMethod.id},
        metadata: {providerId},
      });
      customerId = customer.id;
    }

    await db.collection("providers").doc(providerId).update({
      stripeCustomerId: customerId,
      billingCardLast4: paymentMethod.card?.last4,
      billingCardBrand: paymentMethod.card?.brand,
      billingCardExpMonth: paymentMethod.card?.exp_month,
      billingCardExpYear: paymentMethod.card?.exp_year,
      billingCardName: cardName,
      billingSetupAt: new Date().toISOString(),
    });

    return {
      success: true,
      customerId,
      last4: paymentMethod.card?.last4,
      brand: paymentMethod.card?.brand,
    };
  } catch (error: any) {
    console.error("saveProviderBillingCard error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to save payment method.");
  }
});

export const saveCustomerBillingCard = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");

  const {paymentMethodId, cardName, customerPhone} = request.data;
  const authPhone = (request.auth.token.phone_number as string | undefined) || "";

  if (!paymentMethodId || !customerPhone) {
    throw new HttpsError("invalid-argument", "Missing paymentMethodId or customerPhone.");
  }

  // Security: digits-only comparison so "+14026061003" == "14026061003" both pass.
  // Don't echo the phone numbers in the error (returned to the client + logged) — PII.
  const digits = (s: string) => s.replace(/\D/g, "");
  if (authPhone && digits(authPhone) !== digits(customerPhone)) {
    throw new HttpsError("permission-denied", "You can only save a card for your own account.");
  }

  try {
    const config = await getConfig();
    const stripe = getStripe(config.stripe.secretKey);

    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    // Read existing stripeCustomerId — use get() but don't fail if doc is missing
    const userSnap = await db.collection("users").doc(customerPhone).get();
    let customerId: string = userSnap.exists ? (userSnap.data()!.stripeCustomerId || "") : "";
    // Drop stale customer ids from a previous Stripe mode so we recreate in live mode.
    customerId = await verifyCustomerId(stripe, customerId);

    if (customerId) {
      const existing = await stripe.paymentMethods.list({customer: customerId, type: "card"});
      for (const pm of existing.data) {
        await stripe.paymentMethods.detach(pm.id);
      }
      await stripe.paymentMethods.attach(paymentMethod.id, {customer: customerId});
      await stripe.customers.update(customerId, {
        name: cardName,
        invoice_settings: {default_payment_method: paymentMethod.id},
      });
    } else {
      const customer = await stripe.customers.create({
        name: cardName,
        payment_method: paymentMethod.id,
        invoice_settings: {default_payment_method: paymentMethod.id},
        metadata: {customerPhone},
      });
      customerId = customer.id;
    }

    // Use set+merge so the write succeeds whether or not the doc already exists
    await db.collection("users").doc(customerPhone).set({
      stripeCustomerId: customerId,
      billingPaymentMethodId: paymentMethod.id,
      billingCardLast4: paymentMethod.card?.last4,
      billingCardBrand: paymentMethod.card?.brand,
      billingCardExpMonth: paymentMethod.card?.exp_month,
      billingCardExpYear: paymentMethod.card?.exp_year,
      billingCardName: cardName,
      billingSetupAt: new Date().toISOString(),
    }, {merge: true});

    return {
      success: true,
      customerId,
      paymentMethodId: paymentMethod.id,
      last4: paymentMethod.card?.last4,
      brand: paymentMethod.card?.brand,
    };
  } catch (error: any) {
    console.error("[saveCustomerBillingCard] error:", error);
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message || "Failed to save payment method.");
  }
});

// Verifies the caller is the provider assigned to `orderId` (boundary-safe phone
// match against the `${phone}_${zip}` provider id). Returns the order data.
async function assertCallerOwnsOrder(orderId: unknown, request: any): Promise<any> {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  if (!orderId || typeof orderId !== "string") throw new HttpsError("invalid-argument", "orderId is required.");
  const cleanAuthPhone = ((request.auth.token.phone_number as string) || "").replace(/\D/g, "");
  const snap = await db.collection("orders").doc(orderId).get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;
  const pid = String(order.providerId || "");
  const authorized =
    pid === request.auth.uid ||
    (cleanAuthPhone.length > 0 && pid.startsWith(`${cleanAuthPhone}_`));
  if (!authorized) throw new HttpsError("permission-denied", "You are not assigned to this order.");
  return order;
}

// Provider-private order notes. Stored in `orderNotes/{orderId}`, which no client
// can read or write (default-deny) — only these admin-SDK callables, gated to the
// assigned provider, so the customer never sees the provider's notes.
export const getOrderNote = onCall(async (request) => {
  await assertCallerOwnsOrder(request.data?.orderId, request);
  const snap = await db.collection("orderNotes").doc(request.data.orderId).get();
  return {notes: snap.exists ? (snap.data()?.notes ?? "") : ""};
});

export const setOrderNote = onCall(async (request) => {
  const order = await assertCallerOwnsOrder(request.data?.orderId, request);
  const notes = typeof request.data?.notes === "string" ? request.data.notes.slice(0, 5000) : "";
  await db.collection("orderNotes").doc(request.data.orderId).set({
    orderId: request.data.orderId,
    providerId: order.providerId ?? null,
    notes,
    updatedAt: FieldValue.serverTimestamp(),
  }, {merge: true});
  return {ok: true, notes};
});

// Customer submits a 1–5 star rating (+ optional feedback) for a delivered order.
// A callable (not a direct client write) so ownership/status are enforced server-side;
// the resulting order update fires onOrderUpdatedUpdateStats, which aggregates the
// rating into providerPerformance, mirrors avgRating onto the provider doc, and pushes
// the provider a notification.
export const submitOrderRating = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, rating, feedback} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");
  const stars = Number(rating);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    throw new HttpsError("invalid-argument", "Rating must be a whole number from 1 to 5.");
  }

  const digits = (s: string) => (s || "").replace(/\D/g, "");
  const authPhone = (request.auth.token.phone_number as string) || "";

  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = orderSnap.data() as RentalOrder;

  if (digits(authPhone) !== digits(order.customerPhone)) {
    throw new HttpsError("permission-denied", "You are not authorized to rate this order.");
  }
  if (order.status !== OrderStatus.DELIVERED) {
    throw new HttpsError("failed-precondition", "You can only rate after the order is delivered.");
  }
  if (typeof order.rating === "number") {
    throw new HttpsError("failed-precondition", "This order has already been rated.");
  }

  const cleanFeedback = typeof feedback === "string" ? feedback.trim().slice(0, 500) : "";
  await orderRef.update({
    rating: stars,
    ...(cleanFeedback ? {feedback: cleanFeedback} : {}),
    ratedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return {success: true};
});

// Records a successfully-captured tip on the order and notifies the provider. Used by
// both the off-session path (createTipPaymentIntent) and the payment-sheet path
// (stripeWebhook). Stamps the tip's OWN settlement date so it is paid out independently
// of the base order (tipPayoutRelease).
async function recordTipPaid(orderRef: DocumentReference, order: RentalOrder, pi: Stripe.PaymentIntent, tip: number) {
  const charge = pi.latest_charge && typeof pi.latest_charge !== "string" ? pi.latest_charge as Stripe.Charge : null;
  const bt = charge && charge.balance_transaction && typeof charge.balance_transaction !== "string" ?
    charge.balance_transaction as Stripe.BalanceTransaction : null;
  const nowIso = new Date().toISOString();
  const tipChargeAvailableOn = bt?.available_on ?
    new Date(bt.available_on * 1000).toISOString() :
    new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
  await orderRef.update({
    tip,
    tipPaymentIntentId: pi.id,
    tipChargedAt: nowIso,
    tipChargeAvailableOn,
    tipPayoutStatus: "unpaid",
    updatedAt: nowIso,
  });
  if (order.providerId && order.providerId !== "broadcast") {
    await notifyProvider(
      order.providerId,
      "You got a tip! 🎉",
      `A customer added a $${tip.toFixed(2)} tip to your earnings.`,
      "TIP_RECEIVED",
      orderRef.id,
    );
  }
}

// Customer adds a tip AFTER delivery. The original charge is already captured, so the
// tip is a SEPARATE, immediate-capture PaymentIntent. If the customer has a saved card
// we charge it off-session; otherwise we return a clientSecret for the Stripe payment
// sheet. The tip is provider-kept, untaxed and commission-free (mirrors the priority
// surcharge) and is paid out on its own settlement clock.
export const createTipPaymentIntent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, tipAmount} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");
  const tip = Math.round(Number(tipAmount) * 100) / 100;
  if (!isFinite(tip) || tip <= 0) throw new HttpsError("invalid-argument", "Tip must be greater than 0.");

  const digits = (s: string) => (s || "").replace(/\D/g, "");
  const authPhone = (request.auth.token.phone_number as string) || "";

  try {
    const config = await getConfig();
    const stripe = getStripe(config.stripe.secretKey);

    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = orderSnap.data() as RentalOrder;

    if (digits(authPhone) !== digits(order.customerPhone)) {
      throw new HttpsError("permission-denied", "You are not authorized to tip on this order.");
    }
    if (order.status !== OrderStatus.DELIVERED) {
      throw new HttpsError("failed-precondition", "You can only tip after the order is delivered.");
    }
    if (typeof order.tip === "number" && order.tip > 0) {
      throw new HttpsError("failed-precondition", "A tip has already been added to this order.");
    }
    if (!order.providerId || order.providerId === "broadcast") {
      throw new HttpsError("failed-precondition", "This order has no assigned provider to tip.");
    }

    const amountCents = chargeCentsFor(tip);
    const userSnap = await db.collection("users").doc(order.customerPhone).get();
    const userData = userSnap.exists ? userSnap.data()! : {};
    const stripeCustomerId: string | undefined =
      (await verifyCustomerId(stripe, userData.stripeCustomerId || "")) || undefined;
    // A saved payment method is only usable if its customer still exists in this mode.
    const paymentMethodId: string | undefined = stripeCustomerId ? (userData.billingPaymentMethodId || undefined) : undefined;
    const metadata = {orderId, tip: "true", tipAmount: tip.toFixed(2)};

    // Saved card → charge off-session immediately. Fall back to the payment sheet if
    // the card needs interactive authentication.
    if (stripeCustomerId && paymentMethodId) {
      try {
        const pi = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          customer: stripeCustomerId,
          payment_method: paymentMethodId,
          off_session: true,
          confirm: true,
          metadata,
          expand: ["latest_charge.balance_transaction"],
        });
        if (pi.status === "succeeded") {
          await recordTipPaid(orderRef, order, pi, tip);
          return {charged: true, tip};
        }
        // requires_action / requires_confirmation → finish in the sheet.
        return {clientSecret: pi.client_secret, paymentIntentId: pi.id};
      } catch (e: any) {
        // Card needs authentication off-session → hand the existing PI to the sheet.
        const pendingPi = e?.raw?.payment_intent;
        if (pendingPi?.client_secret) {
          return {clientSecret: pendingPi.client_secret, paymentIntentId: pendingPi.id};
        }
        console.warn("createTipPaymentIntent: off-session charge failed, falling back to sheet", e?.message || e);
      }
    }

    // No saved card (or off-session unusable) → payment sheet. Recorded by the webhook.
    const pi = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      automatic_payment_methods: {enabled: true},
      ...(stripeCustomerId ? {customer: stripeCustomerId} : {}),
      metadata,
    });
    return {clientSecret: pi.client_secret, paymentIntentId: pi.id};
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    console.error("createTipPaymentIntent error:", error);
    throw new HttpsError("internal", error.message || "Failed to create tip payment.");
  }
});

export const cancelOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, reason} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const uid = request.auth.uid;
  const cleanAuthPhone = ((request.auth.token.phone_number as string) || "").replace(/\D/g, "");

  try {
    const result = await db.runTransaction(async (transaction) => {
      const orderRef = db.collection("orders").doc(orderId);
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists) throw new HttpsError("not-found", "Order not found.");
      const order = orderSnap.data() as RentalOrder;

      if (order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED) {
        throw new HttpsError("failed-precondition", "Order is already in a terminal state.");
      }

      const isAssignedProvider = order.providerId === uid || (cleanAuthPhone.length > 0 && order.providerId.startsWith(cleanAuthPhone));

      // Firestore requires ALL reads before ANY writes in a transaction, so read the
      // provider's cancellation-stats doc (when relevant) BEFORE updating the order.
      const trackCancel = isAssignedProvider && order.providerId !== "broadcast";
      const cancelStatsRef = trackCancel ? db.collection("providerCancellations").doc(order.providerId) : null;
      const statsSnap = cancelStatsRef ? await transaction.get(cancelStatsRef) : null;

      // A bike reserved for this order (staff picked its number in Operations) must be
      // freed on cancellation so it doesn't sit stranded as 'reserved'. Read it now —
      // all transaction reads must precede any write.
      const bikeRef = (order as any).bikeId ? db.collection("bikes").doc(String((order as any).bikeId)) : null;
      const bikeSnap = bikeRef ? await transaction.get(bikeRef) : null;

      transaction.update(orderRef, {
        status: OrderStatus.CANCELLED,
        updatedAt: new Date().toISOString(),
        expiryReason: reason || (isAssignedProvider ? "Cancelled by provider" : "Cancelled by customer"),
      });

      // Release the reserved bike back to available stock — but only if it's still held
      // for THIS order and hasn't already gone out (rented/sold).
      if (bikeRef && bikeSnap?.exists) {
        const bike = bikeSnap.data() as any;
        if (bike.currentOrderId === orderId && bike.status === "reserved") {
          transaction.update(bikeRef, {
            status: "available",
            rentedBy: null,
            rentedByName: null,
            rentedDate: null,
            rentalDuration: null,
            expectedEndDate: null,
            currentOrderId: null,
          });
        }
      }

      // Track Provider Cancellation Counts
      if (cancelStatsRef) {
        if (!statsSnap!.exists) {
          transaction.set(cancelStatsRef, {count: 1, lastCancelledAt: new Date().toISOString()});
        } else {
          transaction.update(cancelStatsRef, {count: FieldValue.increment(1), lastCancelledAt: new Date().toISOString()});
        }
      }

      const cancelledByCustomer = !!order.customerPhone && order.customerPhone.replace(/\D/g, "") === cleanAuthPhone;
      return {
        customerPhone: order.customerPhone,
        isAssignedProvider,
        cancelledByCustomer,
        paymentIntentId: order.paymentIntentId,
        // Already-captured charges aren't a "hold" to release — those would need a
        // refund (out of scope here); only release an uncaptured authorization.
        wasCaptured: order.paymentCaptured === true,
      };
    });

    // Release the customer's authorization hold so it doesn't linger on their card
    // until Stripe's ~7-day auto-expiry. Best-effort, after the commit so a retry
    // can't double-fire. Skip captured charges (would require a refund instead).
    if (result.paymentIntentId && !result.wasCaptured) {
      try {
        const config = await getConfig();
        const stripe = getStripe(config.stripe.secretKey);
        const pi = await stripe.paymentIntents.retrieve(result.paymentIntentId);
        if (pi.status !== "canceled" && pi.status !== "succeeded") {
          await stripe.paymentIntents.cancel(result.paymentIntentId);
        }
      } catch (releaseErr) {
        console.warn("cancelOrder: failed to release hold", result.paymentIntentId, releaseErr);
      }
    }

    // Notify the customer when someone OTHER than them cancelled (provider/admin).
    // A provider cancelling a confirmed order is effectively a decline, so we say who
    // cancelled and why. Sent after the commit so a transaction retry can't double-fire.
    if (!result.cancelledByCustomer && result.customerPhone) {
      const title = result.isAssignedProvider ? "Order Cancelled by Provider" : "Order Cancelled";
      const body = `Order ${orderId.replace("order_", "#")} has been cancelled${reason ? `: ${reason}` : "."}`;
      try {
        await notifyCustomer(result.customerPhone, orderId, title, body, "ORDER_CANCELLED");
      } catch (notifyErr) {
        console.warn("cancelOrder: customer notification failed (non-fatal)", notifyErr);
      }
    }

    return {success: true};
  } catch (error: any) {
    if (error instanceof HttpsError) throw error;
    throw new HttpsError("internal", error.message);
  }
});

// NOTE: checkSlotAvailability was removed — it was an unused stub with no auth guard
// that returned Math.random()-based fake availability. No app or web client calls it.
// If real slot capacity is needed later, implement it against the provider's schedule
// + existing orders in the window, with an auth check.

// Anything a real person sends into the general (non-order) support thread alerts
// the FoodyzzHQ desk. Customers were previously silent here — only providers rang
// through — so a customer message sat in the Chat Center until someone happened to
// look. The type distinguishes the two so the app can label the thread it opens.
export const onProviderSupportMessage = onDocumentCreated("supportMessages/{messageId}", async (event) => {
  const message = event.data?.data();
  if (!message || message.senderPhone === "admin" || message.senderPhone === "system") return;
  const isProvider = message.userRole === "provider";
  await notifyAdmin(
    isProvider ? "New Provider Support Request!" : "New Customer Message",
    `${message.userName} needs assistance: "${message.text}"`,
    isProvider ? "NEW_PROVIDER_SUPPORT_MESSAGE" : "NEW_CUSTOMER_SUPPORT_MESSAGE",
    {userPhone: message.userPhone},
  );
});

export const onAdminReplyToSupport = onDocumentCreated("supportMessages/{messageId}", async (event) => {
  const message = event.data?.data();
  // Admin-hub replies are written with senderPhone: "admin" (no senderRole field),
  // and the auto-responder bot uses senderPhone: "system". Recognize all three so a
  // human admin reply pushes to the user just like the bot already did — without
  // this, senderPhone:"admin" messages fell through and no notification was sent.
  const isAdminReply = message?.senderRole === "admin" || message?.senderPhone === "admin" || message?.senderPhone === "system";
  if (!message || !isAdminReply) return;
  if (message.userPhone && message.userRole) {
    await notifySupportUser(message.userPhone, message.userRole, "Admin Reply", `Admin replied: "${message.text}"`, "ADMIN_SUPPORT_REPLY", event.params.messageId);
  }
});

export const onProviderMessageSent = onDocumentCreated("messages/{messageId}", async (event) => {
  const message = event.data?.data();
  if (!message || message.senderRole !== "provider") return;
  const orderSnap = await db.collection("orders").doc(message.orderId).get();
  const order = orderSnap.data();
  if (!order) return;

  // Flag the order so the customer's My Rentals card can surface an in-app unread
  // indicator (badge + tinted card). Mirror of onCustomerMessageSent's
  // providerUnreadMessage. The customer app clears this when it opens the order
  // chat. Set alongside the push so the badge appears even if the push was missed.
  await orderSnap.ref.update({
    customerUnreadMessage: true,
    lastProviderMessageAt: message.timestamp || new Date().toISOString(),
  });

  await notifyCustomer(order.customerPhone, message.orderId, `New Message for Order ${message.orderId.replace("order_", "#")}`, `Provider ${order.providerName} sent: "${message.text}"`, "NEW_PROVIDER_MESSAGE");
});

// Mirror of onProviderMessageSent for the other direction: notify the assigned
// provider when the customer sends a chat message. The provider app listens for
// "NEW_CUSTOMER_MESSAGE" and deep-links to the chat; nothing was emitting it.
export const onCustomerMessageSent = onDocumentCreated("messages/{messageId}", async (event) => {
  const message = event.data?.data();
  if (!message || message.senderRole !== "customer") return;
  const orderSnap = await db.collection("orders").doc(message.orderId).get();
  const order = orderSnap.data() as RentalOrder | undefined;
  if (!order || !order.providerId || order.providerId === "broadcast") return;

  // Flag the order so the provider's Operations feed can surface an in-app
  // unread indicator (pink card + blinking badge + header bell). The provider
  // app clears this when it opens the chat. Set alongside the push so the badge
  // appears even if the device push was missed/disabled.
  await orderSnap.ref.update({
    providerUnreadMessage: true,
    lastCustomerMessageAt: message.timestamp || new Date().toISOString(),
  });

  await notifyProvider(
    order.providerId,
    `New Message for Order ${message.orderId.replace("order_", "#").replace("order_", "#")}`,
    `${order.customerName || "Customer"} sent: "${message.text}"`,
    "NEW_CUSTOMER_MESSAGE",
    message.orderId
  );
});

// Notifies providers when a new order is created — the push that was missing
// entirely, so the provider app's BROADCAST_ORDER / DIRECT_ORDER listeners never
// fired. A directly-assigned order pings just that store; an unclaimed broadcast
// fans out to every onboarded store in the order's zip that is eligible to receive
// broadcasts (not admin-blocked, services not paused) — mirroring the dispatch feed.
export const onOrderCreatedNotify = onDocumentCreated("orders/{orderId}", async (event) => {
  const order = event.data?.data() as (RentalOrder & { zipCode?: string }) | undefined;
  if (!order) return;
  const orderId = event.params.orderId;
  const label = orderId.replace("WASH_", "#").replace("order_", "#");

  // Directly assigned at creation → ping that store only.
  if (order.providerId && order.providerId !== "broadcast") {
    await notifyProvider(order.providerId, "New Order Assigned", `Order ${label} was sent directly to you.`, "DIRECT_ORDER", orderId);
    return;
  }

  // Broadcast → fan out to onboarded, eligible stores WITHIN the radius the
  // customer chose (broadcastRadius) of the order anchor (customerLat/Lng). The
  // feed query can't range-filter on geo, so scan onboarded stores and filter by
  // distance here. Falls back to a same-zip match for legacy orders that have no
  // anchor coordinates.
  const anchorLat = (order as any).customerLat;
  const anchorLng = (order as any).customerLng;
  const hasAnchor = typeof anchorLat === "number" && typeof anchorLng === "number";
  const radius = typeof (order as any).broadcastRadius === "number" ?
    (order as any).broadcastRadius :
    DEFAULT_BROADCAST_RADIUS;

  // Cap how many stores a single broadcast reaches: even inside the customer's radius a
  // dense area shouldn't blast every provider. Target the CLOSEST N (also bounds push +
  // downstream read cost). Anticipated provider counts are small, so 25 is generous.
  const MAX_BROADCAST_TARGETS = 25;
  let candidates: QueryDocumentSnapshot[];
  let scopeLabel: string;
  if (hasAnchor) {
    const snap = await db.collection("providers").where("onboarded", "==", true).get();
    // Distance-tag every provider, keep those in radius, sort nearest-first, take N.
    // Providers with no coords sort out (dist = Infinity fails the radius check).
    const inRadius = snap.docs
      .map((doc) => {
        const p = doc.data();
        const dist = (typeof p.lat === "number" && typeof p.lng === "number") ?
          calculateDistance(`${anchorLat},${anchorLng}`, `${p.lat},${p.lng}`) :
          Infinity;
        return {doc, dist};
      })
      .filter((x) => x.dist <= radius)
      .sort((a, b) => a.dist - b.dist);
    candidates = inRadius.slice(0, MAX_BROADCAST_TARGETS).map((x) => x.doc);
    scopeLabel = inRadius.length > MAX_BROADCAST_TARGETS ?
      `closest ${MAX_BROADCAST_TARGETS} within ${radius}mi (of ${inRadius.length})` :
      `within ${radius}mi`;
  } else {
    const zip = order.zipCode;
    if (!zip) {
      console.warn(`onOrderCreatedNotify: order ${orderId} has no anchor or zipCode; skipping broadcast notify`); return;
    }
    const snap = await db.collection("providers")
      .where("onboarded", "==", true)
      .where("zipCode", "==", zip)
      .limit(MAX_BROADCAST_TARGETS)
      .get();
    candidates = snap.docs;
    scopeLabel = `in zip ${zip}`;
  }

  const messages: ExpoMessage[] = [];
  // Bump every recipient's app-icon badge in ONE batched commit rather than a
  // separate write per provider — a broadcast can reach many stores in a zip,
  // and N uncoordinated increments would be a needless write burst. (A batch
  // caps at 500 ops; provider counts per zip are far below that.)
  const badgeBatch = db.batch();
  let badgeWrites = 0;
  candidates.forEach((doc) => {
    const p = doc.data();
    if (p.isBlocked === true || p.servicesActive === false) return; // mirror canReceiveBroadcasts
    if (!p.fcmToken) return;
    // set(merge) not update(): update() throws "no entity to update" and aborts
    // the WHOLE batch if any target doc is missing at commit time (e.g. a provider
    // deleted between the query and the commit). merge+increment is the correct
    // idiom for a counter and can't fail that way.
    badgeBatch.set(doc.ref, {badgeCount: FieldValue.increment(1)}, {merge: true});
    badgeWrites++;
    messages.push({
      to: p.fcmToken,
      title: "New Order Available",
      body: `A new rental (${label}) is available in your area.`,
      soundName: providerSoundName(p),
      badge: (typeof p.badgeCount === "number" ? p.badgeCount : 0) + 1,
      data: {type: "BROADCAST_ORDER", orderId, timestamp: Timestamp.now().toMillis().toString()},
      ref: doc.ref,
    });
  });
  if (messages.length) {
    if (badgeWrites) badgeBatch.commit().catch((err) => console.error("broadcast badge batch failed:", err));
    const sent = await sendExpoPush(messages);
    console.log(`onOrderCreatedNotify: broadcast ${orderId} → ${sent}/${messages.length} providers ${scopeLabel}`);
  }
});

export const cleanupExpiredPromos = onSchedule({schedule: "every 24 hours", timeoutSeconds: 300}, async (_event) => {
  const todayISO = new Date().toISOString().split("T")[0];
  const expiredPromosSnap = await db.collection("promos").where("expirationDate", "<=", todayISO).where("isActive", "==", true).get();
  if (expiredPromosSnap.empty) return;
  const batch = db.batch();
  expiredPromosSnap.forEach((doc) => batch.update(doc.ref, {isActive: false, deactivatedAt: FieldValue.serverTimestamp()}));
  await batch.commit();
  // Tell each owning provider their promo expired — the provider app deep-links
  // to the Promos screen using the promoId. Best-effort, in parallel.
  await Promise.all(expiredPromosSnap.docs.map(async (doc) => {
    const promo = doc.data();
    if (!promo?.providerId) return;
    try {
      await notifyProvider(
        promo.providerId,
        "Promo Expired",
        `Your promo "${promo.text || doc.id}" has expired and is no longer active.`,
        "PROMO_DEACTIVATED",
        undefined,
        doc.id
      );
    } catch (e) {
      console.warn(`cleanupExpiredPromos: notify failed for promo ${doc.id}`, e);
    }
  }));
  return;
});

export const incrementPromoViews = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");
  const {promoId} = request.data;
  const promoRef = db.collection("promos").doc(promoId);
  const promoSnap = await promoRef.get();
  if (promoSnap.data()?.isActive !== true) return {success: false};
  await promoRef.update({viewsCounter: FieldValue.increment(1)});
  return {success: true};
});

// Cancels broadcast orders no provider has claimed within 12 hours: releases the
// customer's authorization hold (so the card isn't held until Stripe's ~7-day
// auto-expiry) and tells them no provider was available. Runs hourly and is
// bounded per run so a backlog can't exceed the Stripe rate limit or the 500-op
// batch cap; any overflow is handled by the next run. The (status, providerId,
// createdAt) query is served by the existing orders composite index.
export const expireStaleOrders = onSchedule({schedule: "every 1 hours", timeoutSeconds: 300}, async (_event) => {
  const threshold = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const staleSnap = await db.collection("orders")
    .where("status", "==", "requested")
    .where("providerId", "==", "broadcast")
    .where("createdAt", "<", threshold)
    .limit(100)
    .get();
  if (staleSnap.empty) return;
  if (staleSnap.size === 100) {
    console.warn("expireStaleOrders: hit 100-order cap; remaining stale orders will be handled next run.");
  }

  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);
  const now = new Date().toISOString();

  // Release each dangling authorization hold (best-effort, in parallel — one
  // failure must not block cancelling the rest).
  await Promise.allSettled(staleSnap.docs.map(async (doc) => {
    const order = doc.data() as RentalOrder;
    if (!order.paymentIntentId) return;
    const pi = await stripe.paymentIntents.retrieve(order.paymentIntentId);
    if (pi.status !== "canceled" && pi.status !== "succeeded") {
      await stripe.paymentIntents.cancel(order.paymentIntentId);
    }
  }));

  const batch = db.batch();
  staleSnap.forEach((doc) => batch.update(doc.ref, {
    status: "cancelled",
    expiryReason: "timeout",
    paymentError: "No provider available",
    updatedAt: now,
  }));
  await batch.commit();

  // Tell each customer (best-effort; a notification failure must not abort the run).
  await Promise.allSettled(staleSnap.docs.map((doc) => {
    const order = doc.data() as RentalOrder;
    return notifyCustomer(
      order.customerPhone,
      doc.id,
      "No Provider Available",
      `We couldn't find a provider for your rental ${doc.id.replace("order_", "#")}. Your payment hold has been released — you were not charged.`,
      "ORDER_CANCELLED",
    );
  }));
});

// NOTE: processMarketingInvoices (monthly promo-view billing) was removed — promos
// carry no cost and FoodyzzHQ is the sole provider, so there is nothing to bill.
// It also did an unbounded providers scan + per-provider N+1 + a single 500-op batch,
// which would have failed at scale. Its deployed Cloud Scheduler job must be deleted
// after this deploys (firebase removes the function; delete the schedule if it lingers).

// ── Platform-wide live counts (admin console headline metrics) ───────────────
// A single aggregate doc the admin console reads INSTEAD of streaming whole
// collections just to render a number/badge. Maintained by FieldValue.increment
// from the order/user/provider triggers. Like updateDailyStats, the increments are
// at-least-once (a trigger retry can over-count) — acceptable for headline metrics,
// and a periodic backfill can reconcile. Shape:
//   { ordersTotal, ordersByStatus: {<status>: n}, usersTotal, providersTotal,
//     pendingLicenses, updatedAt }
// activeOrders is derived on the client as ordersTotal - delivered - cancelled.
const PLATFORM_COUNTS_DOC = "stats/platformCounts";
async function bumpPlatformCounts(update: Record<string, any>) {
  await db.doc(PLATFORM_COUNTS_DOC).set(
    {...update, updatedAt: FieldValue.serverTimestamp()},
    {merge: true},
  );
}
// A customer's license is "pending" when a front image was uploaded but not yet
// reviewed — mirrors the admin console's pending predicate exactly.
function isLicensePending(u: any): boolean {
  return !!(u?.driverLicense?.frontPath && !u?.driverLicense?.reviewedAt);
}

export const onOrderCreatedUpdateStats = onDocumentCreated("orders/{orderId}", async (event) => {
  const order = event.data?.data() as RentalOrder;
  if (!order) return;
  const today = new Date().toISOString().split("T")[0];
  const promises = [updateDailyStats(today, {orderCount: 1})];
  if (order.providerId !== "broadcast") promises.push(updateProviderStats(order.providerId, {attempts: 1, lastOrderAt: order.createdAt}));
  // Aggregate counts for the admin console (total + per-status bucket).
  promises.push(bumpPlatformCounts({
    ordersTotal: FieldValue.increment(1),
    ordersByStatus: {[order.status]: FieldValue.increment(1)},
  }));
  await Promise.all(promises);
});

export const onOrderUpdatedUpdateStats = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data?.before.data() as RentalOrder; const after = event.data?.after.data() as RentalOrder;
  if (!before || !after) return;
  const today = new Date().toISOString().split("T")[0]; const providerId = after.providerId;
  const dUp: any = {}; const pUp: any = {};

  if (before.providerId === "broadcast" && providerId !== "broadcast") {
    pUp.attempts = 1; pUp.lastOrderAt = after.createdAt;
  }
  if (before.status !== OrderStatus.CANCELLED && after.status === OrderStatus.CANCELLED) dUp.cancelledCount = 1;

  const terminal = [OrderStatus.COMPLETED, OrderStatus.DELIVERED];
  if (!terminal.includes(before.status) && terminal.includes(after.status)) {
    const rev = after.finalPrice || after.estimatedPrice || 0;
    dUp.totalRevenue = rev;
    const cfg = await getConfig();
    dUp.totalCommission = rev * (cfg?.commissionRate || 0.15);
    if (providerId && providerId !== "broadcast") {
      pUp.completed = 1; pUp.revenue = rev;
    }
  }

  if (!before.rating && after.rating) {
    dUp.ratedCount = 1; dUp.ratingSum = after.rating;
    if (providerId && providerId !== "broadcast") {
      pUp.ratingCount = 1; pUp.ratingSum = after.rating;
    }
  }

  const promises = [];
  if (Object.keys(dUp).length > 0) promises.push(updateDailyStats(today, dUp));
  if (Object.keys(pUp).length > 0 && providerId && providerId !== "broadcast") promises.push(updateProviderStats(providerId, pUp));
  // Keep the per-status order buckets in the aggregate doc in sync on a status change.
  if (before.status !== after.status) {
    promises.push(bumpPlatformCounts({
      ordersByStatus: {
        [before.status]: FieldValue.increment(-1),
        [after.status]: FieldValue.increment(1),
      },
    }));
  }
  // Notify the provider the moment a rating lands (separate from the aggregation above).
  if (!before.rating && after.rating && providerId && providerId !== "broadcast") {
    const fb = after.feedback ? `: “${after.feedback}”` : "";
    promises.push(notifyProvider(providerId, "New rating ⭐", `A customer rated you ${after.rating}★${fb}.`, "RATING_RECEIVED", event.params.orderId));
    // Publish a redacted, publicly-readable copy of the rating so OTHER customers can
    // browse it (orders are locked to the owning customer). Written for EVERY rating so
    // the browsable list matches the star count on the provider card; the written
    // comment is included only when the customer left one. Doc id = orderId keeps this
    // idempotent if the trigger re-fires. Deliberate allow-list: never copy phone /
    // address / prices or any other order field.
    const comment = typeof after.feedback === "string" ? after.feedback.trim() : "";
    promises.push(db.collection("providers").doc(providerId).collection("reviews").doc(event.params.orderId).set({
      stars: after.rating,
      ...(comment ? {comment} : {}),
      firstName: (after.customerName || "").trim().split(/\s+/)[0] || "Customer",
      ratedAt: after.ratedAt || new Date().toISOString(),
    }));
  }
  if (promises.length > 0) await Promise.all(promises);
});

// ── Order mirror for the HQ device feed ──────────────────────────────────────
// The RN Firebase client SDK can't project fields on a read, so HQ subscribes to
// `providerOrders/{orderId}` rather than `orders`. Foodyzz owns the fleet and HQ is
// first-party staff, so the customer's charge is NOT hidden — HQ needs to see what
// will be captured. Only raw Stripe object identifiers are stripped: the device has
// no use for them and they shouldn't sit in an extra collection.
const PROVIDER_HIDDEN_ORDER_FIELDS = new Set([
  "paymentIntentId", "tipPaymentIntentId", "depositPaymentIntentId",
  "depositPaymentMethodId",
]);

export const onOrderWriteMirrorForProvider = onDocumentWritten("orders/{orderId}", async (event) => {
  const orderId = event.params.orderId;
  const ref = db.collection("providerOrders").doc(orderId);

  const after = event.data?.after;
  if (!after || !after.exists) {
    await ref.delete().catch(() => {});
    return;
  }

  const data = after.data() || {};
  const safe: Record<string, any> = {};
  for (const [k, v] of Object.entries(data)) {
    if (PROVIDER_HIDDEN_ORDER_FIELDS.has(k)) continue;
    safe[k] = v;
  }
  safe.id = orderId;
  // Full overwrite (set without merge) so a field removed upstream also disappears
  // from the mirror.
  await ref.set(safe).catch((e) => console.warn(`mirror ${orderId} failed (non-fatal):`, e));
});

// `stats/{date}` is written on EVERY order create + status change across all
// providers, so it's the platform's hottest document. A read-modify-write
// transaction serialized every event (~1 write/sec) and retried under contention.
// Atomic FieldValue.increment() is conflict-free — no read, no transaction, no
// retries — which lifts sustained throughput by ~10–100×. averageSatisfaction is
// a derived ratio (ratingSum / ratedCount) and is computed at read time by the
// admin dashboard instead of being stored here.
async function updateDailyStats(date: string, stats: any) {
  const ref = db.collection("stats").doc(date);
  const update: Record<string, any> = {date, updatedAt: FieldValue.serverTimestamp()};
  if (stats.orderCount) update.orderCount = FieldValue.increment(stats.orderCount);
  if (stats.cancelledCount) update.cancelledCount = FieldValue.increment(stats.cancelledCount);
  if (stats.totalRevenue) update.totalRevenue = FieldValue.increment(stats.totalRevenue);
  if (stats.totalCommission) update.totalCommission = FieldValue.increment(stats.totalCommission);
  if (stats.ratedCount) update.ratedCount = FieldValue.increment(stats.ratedCount);
  if (stats.ratingSum) update.ratingSum = FieldValue.increment(stats.ratingSum);
  await ref.set(update, {merge: true});
}

async function updateProviderStats(providerId: string, stats: any) {
  const ref = db.collection("providerPerformance").doc(providerId);
  await db.runTransaction(async (t) => {
    const d = (await t.get(ref)).data() as ProviderPerformance || {providerId, businessName: "Unknown", totalRevenue: 0, ordersCompleted: 0, totalAttempts: 0, ratingSum: 0, ratedCount: 0, completionRate: 0, avgRating: 5.0, lastOrderAt: ""};
    if (stats.attempts) d.totalAttempts += stats.attempts;
    if (stats.completed) d.ordersCompleted += stats.completed;
    if (stats.revenue) d.totalRevenue += stats.revenue;
    if (stats.ratingCount) d.ratedCount += stats.ratingCount;
    if (stats.ratingSum) d.ratingSum += stats.ratingSum;
    if (stats.lastOrderAt && (!d.lastOrderAt || stats.lastOrderAt > d.lastOrderAt)) d.lastOrderAt = stats.lastOrderAt;
    if (d.businessName === "Unknown") {
      const p = await t.get(db.collection("providers").doc(providerId));
      if (p.exists) d.businessName = p.data()?.businessName || "Unknown";
    }
    if (d.totalAttempts > 0) d.completionRate = (d.ordersCompleted / d.totalAttempts) * 100;
    if (d.ratedCount > 0) d.avgRating = d.ratingSum / d.ratedCount;
    t.set(ref, {...d, updatedAt: FieldValue.serverTimestamp()});
    // Mirror the running rating onto the provider doc so the customer search (which
    // streams `providers`, not `providerPerformance`) can show stars without an extra
    // read. Only on a rating change — onProviderWriteUpdateTaxTable ignores these
    // fields, so this won't trigger a tax-table rebuild.
    if (stats.ratingCount || stats.ratingSum) {
      t.set(db.collection("providers").doc(providerId), {avgRating: d.avgRating, ratedCount: d.ratedCount}, {merge: true});
    }
  });
}

export const onOrderCancelledNotifyProvider = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data?.before.data(); const after = event.data?.after.data();
  if (before?.status !== "cancelled" && after?.status === "cancelled") {
    if (after.providerId && after.providerId !== "broadcast") {
      await notifyProvider(after.providerId, "Order Cancelled", `Rental ${event.params.orderId.replace("order_", "#")} has been cancelled.`, "ORDER_CANCELLED", event.params.orderId);
    }
  }
});

// When an order reaches `delivered` (via the one-tap completion or the proximity/
// status callable), tell the customer it's done and prompt them to rate + tip. A
// Firestore trigger so it fires no matter which path set the status.
// FoodyzzHQ asked this customer for their driver license and proof of address.
// Fires once, when `idRequestedAt` first appears on the order.
// ── Delivery lifecycle notifications ────────────────────────────────────────
// One trigger drives every customer-facing message on the delivery flow, so the
// copy for each state lives in a single place.
// Builds the receipt table for the delivery email: the captured charge broken into
// its lines, the deposit's status, and the handover inspection notes.
function deliveryReceiptHtml(order: any): string {
  const money = (n: any) => `$${Number(n || 0).toFixed(2)}`;
  const rows: string[] = [];
  const row = (label: string, value: string, strong = false) =>
    `<tr>
       <td style="padding:6px 0;color:#475569;font-size:14px${strong ? ";font-weight:bold;color:#0f172a" : ""}">${label}</td>
       <td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px${strong ? ";font-weight:bold" : ""}">${value}</td>
     </tr>`;

  // Bike rental line shows the rate × term only — the fee bundle is itemised
  // separately below so the numbers reconcile (rental + fees = subtotal).
  const periods = Number(order.durationValue) || 1;
  const unitWord = order.durationUnit === "months" ? "month" : "week";
  const baseRate = Number(order.baseRate || 0);
  const isBuy = order.rentalType === "buy";
  const isRentToBuy = order.rentalType === "rentToBuy";
  // Rent-to-buy bills ONE period at delivery (the rest are charged monthly), so the
  // receipt shows a single period's rate — this reconciles with the subtotal (one
  // period + fees). Plain rent charges the whole committed term up front (rate × weeks).
  const rentalOnly = isBuy || isRentToBuy ? baseRate : baseRate * periods;
  const termDesc = isBuy ?
    "" :
    `${periods} ${unitWord}${periods === 1 ? "" : "s"} · ${money(baseRate)}/${unitWord === "month" ? "mo" : "wk"}`;
  rows.push(row(`Bike rental${termDesc ? ` (${termDesc})` : ""}`, money(rentalOnly)));

  // Accepted, non-deposit fees, itemised once per rental period.
  for (const f of Array.isArray(order.fees) ? order.fees : []) {
    if (f?.accepted && !f?.isDeposit && f?.key !== "deposit") {
      rows.push(row(String(f.label || "Fee"), money(f.amount)));
    }
  }

  // Subtotal (rental + fees) before tax and card processing.
  rows.push(row("Subtotal", money(order.orderSubtotal ?? rentalOnly), true));
  // Customer receipt combines sales tax + card processing into one "Taxes and fees"
  // line. FoodyzzHQ (admin/provider) still sees them itemized separately.
  const taxesAndFees = Number(order.tax || 0) + Number(order.ccProcessingFee || 0);
  if (taxesAndFees > 0) rows.push(row("Taxes and fees", money(taxesAndFees)));
  rows.push(row("Total charges", money(order.chargedAmount ?? order.estimatedPrice), true));

  const deposit = Number(order.depositAmount || 0);
  const depositNote = deposit > 0 ?
    `<p style="margin:16px 0 0;color:#475569;font-size:13px;line-height:1.6">
         A <strong>${money(deposit)}</strong> security deposit was charged as a separate transaction. It is
         refunded when you return the bike, minus any adjustments for damage.
       </p>` :
    "";

  const notes = String(order?.conditionAtDelivery?.notes || "").trim();
  const notesBlock = notes ?
    `<div style="margin:20px 0 0;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
         <p style="margin:0 0 6px;color:#0f172a;font-size:12px;font-weight:bold;text-transform:uppercase;letter-spacing:.05em">Bike condition at handover</p>
         <p style="margin:0;color:#475569;font-size:13px;line-height:1.6;white-space:pre-wrap">${escapeHtml(notes)}</p>
       </div>` :
    "";

  return `
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:8px 0">
      ${rows.join("")}
    </table>
    ${depositNote}
    ${notesBlock}`;
}

// Minimal HTML-escape for customer-entered condition notes in an email body.
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c] as string
  ));
}

// Sends a branded email to the order's customer, looked up from their profile.
// No-ops silently when the customer has no email on file.
async function emailCustomer(
  order: any,
  subject: string,
  body: { title: string; intro: string; bodyHtml?: string },
): Promise<void> {
  const phone = order?.customerPhone;
  if (!phone) return;
  const snap = await db.collection("users").doc(String(phone)).get();
  const email = snap.data()?.email;
  if (!email) return;
  await sendEmail(String(email), subject, emailLayout({...body, brand: "Foodyzz"}));
}

export const onOrderDeliveryStatusNotify = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after || before?.status === after.status) return;

  const orderId = event.params.orderId;
  const ref = orderId.replace("order_", "#");
  const store = after.providerName || "FoodyzzHQ";
  const name = (after.customerName || "there").split(" ")[0];

  try {
    switch (after.status) {
    case OrderStatus.READY_FOR_DELIVERY: {
      // A buy skips document review entirely, so it must not claim "documents verified".
      const isBuy = after.rentalType === "buy";
      const deliverWhen = `${after.startDate || "your selected date"}` +
          `${after.deliveryTime ? ` between ${after.deliveryTime}` : ""}`;
      await notifyCustomer(
        after.customerPhone, orderId,
        isBuy ? "Order confirmed — bike on the way" : "You're verified — bike on the way",
        isBuy ?
          `${store} is preparing your bike for delivery.` :
          `Your documents are verified. ${store} is preparing your bike for delivery.`,
        isBuy ? "ORDER_CONFIRMED" : "DOCS_VERIFIED",
      );
      await emailCustomer(after, `Your Foodyzz ${isBuy ? "order" : "rental"} ${ref} is confirmed`, {
        title: isBuy ? "Order confirmed" : "You're verified",
        intro: isBuy ?
          `Hi ${name} — ${store} is preparing your bike now and will deliver it on ${deliverWhen}.` :
          `Hi ${name} — your ID and proof of address have been verified. ` +
              `${store} is preparing your bike now and will deliver it on ${deliverWhen}.`,
      });
      break;
    }
    case OrderStatus.EN_ROUTE_DELIVERY: {
      await notifyCustomer(
        after.customerPhone, orderId,
        "Your bike is on the way",
        `${store} has set off with your bike. Please make sure someone is there to receive it.`,
        "OUT_FOR_DELIVERY",
      );
      await emailCustomer(after, `Your Foodyzz bike ${ref} is on its way`, {
        title: "We're on our way",
        intro: `Hi ${name} — ${store} is on the way with your bike. ` +
                 "Please make sure you are home to receive it and to check it over with the rider.",
      });
      break;
    }
    case OrderStatus.AT_DELIVERY: {
      // Arrival is time-critical, so this one is a push only — no email.
      await notifyCustomer(
        after.customerPhone, orderId,
        `${store} is outside`,
        "Your bike has arrived. Please come out to meet the rider and inspect the bike together.",
        "ARRIVED_AT_DELIVERY",
      );
      break;
    }
    case OrderStatus.DELIVERED: {
      const charged = Number(after.chargedAmount ?? after.estimatedPrice ?? 0).toFixed(2);
      const deposit = Number(after.depositAmount ?? 0).toFixed(2);
      await notifyCustomer(
        after.customerPhone, orderId,
        "Enjoy your ride",
        `Your bike is delivered. $${charged} charged${Number(deposit) > 0 ? `, $${deposit} deposit held` : ""}.`,
        "ORDER_DELIVERED",
      );
      // Emailed receipt: the captured charge broken out, the deposit status, and
      // any condition notes recorded during the handover inspection, so the
      // customer has a durable record of both the money and the bike's condition.
      await emailCustomer(after, `Your Foodyzz rental receipt ${ref}`, {
        title: "Delivered — here's your receipt",
        intro: `Hi ${name}, your bike is delivered and your rental has started. ` +
                 "Here is what was charged today.",
        bodyHtml: deliveryReceiptHtml(after),
      }).catch((e) => console.warn(`delivery receipt email failed for ${orderId}`, e));
      break;
    }
    case OrderStatus.COMPLETED: {
      // A buy completes at delivery (no return leg), so its "delivered + receipt"
      // message rides on the COMPLETED transition. Rent returns and rent-to-buy
      // payoffs also reach COMPLETED but send their own receipts from their
      // callables, so only the buy path is handled here.
      if (after.rentalType !== "buy") break;
      const charged = Number(after.chargedAmount ?? after.estimatedPrice ?? 0).toFixed(2);
      await notifyCustomer(
        after.customerPhone, orderId,
        "Enjoy your ride",
        `Your bike is delivered and yours to keep. $${charged} charged.`,
        "ORDER_DELIVERED",
      );
      await emailCustomer(after, `Your Foodyzz purchase receipt ${ref}`, {
        title: "Delivered — here's your receipt",
        intro: `Hi ${name}, your bike is delivered and it's yours to keep. ` +
                 "Here is what was charged today.",
        bodyHtml: deliveryReceiptHtml(after),
      }).catch((e) => console.warn(`purchase receipt email failed for ${orderId}`, e));
      break;
    }
    default:
      break;
    }
  } catch (err) {
    // Never fail the status write because a message could not be sent.
    console.warn(`onOrderDeliveryStatusNotify: ${after.status} notify failed for ${orderId}`, err);
  }
});

/**
 * Bike handed over. One call so the three things that must happen together do:
 *   1. capture the authorized rental charge,
 *   2. place a SEPARATE hold for the security deposit (authorize, never capture),
 *   3. record the bike's condition at handover for both parties.
 * The deposit is a second PaymentIntent rather than part of the rental charge, so the
 * customer sees two distinct entries and the deposit can be released independently.
 */
// Charge the security deposit as a real, separate transaction at delivery — the
// "second charge" the customer is told about. Off-session against the retained card,
// idempotency-keyed on the order so a retry can't double-charge.
async function chargeSecurityDeposit(
  stripe: Stripe, orderId: string, customerId: string, paymentMethodId: string, amount: number,
): Promise<{ ok: true; pi: Stripe.PaymentIntent } | { ok: false; error: string }> {
  try {
    const pi = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100),
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: `Foodyzz security deposit — order ${orderId.replace("order_", "#")}`,
      metadata: {orderId, kind: "security_deposit"},
    }, {idempotencyKey: `${orderId}:deposit`});
    return {ok: true, pi};
  } catch (err: any) {
    return {ok: false, error: String(err?.message ?? err)};
  }
}

// Refund a previously-charged deposit (full or partial) back to the card it was taken
// from. Best-effort: the caller decides whether a failure is fatal.
async function refundChargedDeposit(
  stripe: Stripe, orderId: string, paymentIntentId: string, amount: number,
): Promise<{ ok: true; refundId: string } | { ok: false; error: string }> {
  try {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: Math.round(amount * 100),
      metadata: {orderId, kind: "security_deposit_refund"},
    });
    return {ok: true, refundId: refund.id};
  } catch (err: any) {
    return {ok: false, error: String(err?.message ?? err)};
  }
}

// Conditions a rental type may draw a bike from (mirrors the client's allowedConditions):
// only a plain rent may take a used bike; rent-to-buy and buy start from NEW stock.
const bikeConditionsFor = (rentalType: string): string[] =>
  rentalType === "rent" ? ["new", "used"] : ["new"];

/**
 * Assign (or, while still Ready for Delivery, re-assign) a physical bike to an order.
 *
 * Bike inventory writes are admin/server-only (firestore.rules), so the HQ device can
 * read the `bikes` collection to populate its picker but cannot reserve one directly —
 * it calls this. The whole thing runs in a transaction so two orders can never reserve
 * the same bike: the picked bike must still be `available`, and it is flipped to
 * `reserved` and stamped onto the order atomically.
 *
 * Re-assignment is allowed ONLY while the order is still READY_FOR_DELIVERY (before the
 * rider sets off). Swapping frees the previously-reserved bike back to `available`.
 * Once delivery has started the bike is locked in.
 */
export const assignBikeToOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, bikeId} = request.data;
  if (!orderId || !bikeId) throw new HttpsError("invalid-argument", "Missing orderId or bikeId.");

  const orderRef = db.collection("orders").doc(String(orderId));
  const newBikeRef = db.collection("bikes").doc(String(bikeId));

  const result = await db.runTransaction(async (tx) => {
    // ── All reads first (Firestore requires reads before writes) ────────────
    const oSnap = await tx.get(orderRef);
    if (!oSnap.exists) throw new HttpsError("not-found", "Order not found.");
    const order = oSnap.data() as any;

    // Idempotent: already on this exact bike → nothing to do.
    if (order.bikeId && String(order.bikeId) === String(bikeId)) {
      return {bikeNo: order.bikeNo ?? null};
    }

    const reassigning = !!order.bikeId;
    // A bike is locked in once the rider has set off; only swap while still Ready.
    if (reassigning && order.status !== OrderStatus.READY_FOR_DELIVERY) {
      throw new HttpsError("failed-precondition", "The bike is locked once delivery has started.");
    }

    const newBikeSnap = await tx.get(newBikeRef);
    if (!newBikeSnap.exists) throw new HttpsError("not-found", "That bike no longer exists.");
    const newBike = newBikeSnap.data() as any;

    // Read the currently-reserved bike (if any) before writing, so a swap can free it.
    const oldBikeRef = reassigning ? db.collection("bikes").doc(String(order.bikeId)) : null;
    const oldBikeSnap = oldBikeRef ? await tx.get(oldBikeRef) : null;

    // ── Validate the picked bike ────────────────────────────────────────────
    if (Number(newBike.model) !== Number(order.bikeModel)) {
      throw new HttpsError("failed-precondition", "That bike is a different model than the order.");
    }
    if (!bikeConditionsFor(String(order.rentalType || "rent")).includes(newBike.condition)) {
      throw new HttpsError(
        "failed-precondition",
        `This order needs a new bike; #${newBike.bikeNo} is ${newBike.condition}.`,
      );
    }
    if (newBike.status !== "available") {
      throw new HttpsError("failed-precondition", `Bike #${newBike.bikeNo} is ${newBike.status}, not available.`);
    }

    // ── Writes ──────────────────────────────────────────────────────────────
    const nowIso = new Date().toISOString();
    // Free the previously-reserved bike, but only if it still points at THIS order
    // (guards against clobbering a bike that was meanwhile reserved elsewhere).
    if (oldBikeSnap?.exists && (oldBikeSnap.data() as any).currentOrderId === String(orderId)) {
      tx.update(oldBikeRef!, {
        status: "available",
        rentedBy: null,
        rentedByName: null,
        rentedDate: null,
        rentalDuration: null,
        expectedEndDate: null,
        currentOrderId: null,
      });
    }
    tx.update(newBikeRef, {
      status: "reserved",
      rentedBy: order.customerPhone ?? null,
      rentedByName: order.customerName ?? null,
      rentedDate: order.startDate ?? null,
      rentalDuration: order.durationValue ? `${order.durationValue} ${order.durationUnit ?? ""}`.trim() : null,
      expectedEndDate: order.expectedEndDate ?? null,
      currentOrderId: String(orderId),
    });
    tx.update(orderRef, {
      bikeId: String(bikeId),
      bikeNo: newBike.bikeNo ?? null,
      bikeCondition: newBike.condition ?? null,
      updatedAt: nowIso,
    });
    return {bikeNo: newBike.bikeNo ?? null};
  });

  return {success: true, ...result};
});

export const markRentalDelivered = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, conditionNotes, conditionPhotoPaths} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);
  const orderRef = db.collection("orders").doc(String(orderId));
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  // A buy is a one-time purchase: there is no return leg and no refundable deposit, so
  // handing the bike over IS the end of the transaction. It goes straight to COMPLETED
  // (the rental charge is still captured below); a rent/rent-to-buy stays DELIVERED.
  const isBuy = order.rentalType === "buy";
  const nowIso = new Date().toISOString();

  const updates: Record<string, any> = {
    status: isBuy ? OrderStatus.COMPLETED : OrderStatus.DELIVERED,
    deliveredAt: nowIso,
    updatedAt: nowIso,
    conditionAtDelivery: {
      notes: typeof conditionNotes === "string" ? conditionNotes.trim() : "",
      photoPaths: Array.isArray(conditionPhotoPaths) ? conditionPhotoPaths.slice(0, 12) : [],
      recordedAt: nowIso,
      recordedBy: order.providerId ?? null,
    },
  };
  if (isBuy) updates.completedAt = nowIso;

  // Card and customer taken from the rental PaymentIntent, used as the fallback for
  // the deposit hold when the profile has no saved card recorded yet.
  let rentalPaymentMethodId = "";
  let rentalCustomerId = "";

  // ── 1. Capture the rental ────────────────────────────────────────────────
  if (order.paymentIntentId && order.paymentCaptured !== true) {
    try {
      const pi = await stripe.paymentIntents.retrieve(order.paymentIntentId);
      if (typeof pi.payment_method === "string") rentalPaymentMethodId = pi.payment_method;
      if (typeof pi.customer === "string") rentalCustomerId = pi.customer;
      if (pi.status === "requires_capture") {
        const captured = await stripe.paymentIntents.capture(order.paymentIntentId);
        updates.paymentCaptured = true;
        updates.chargedAmount = (captured.amount_received ?? captured.amount) / 100;
        updates.chargedAt = new Date().toISOString();
      } else if (pi.status === "succeeded") {
        updates.paymentCaptured = true;
        updates.chargedAmount = (pi.amount_received ?? pi.amount) / 100;
      }
    } catch (err: any) {
      // A capture failure must not silently mark the bike delivered.
      throw new HttpsError("failed-precondition", `Could not charge the rental: ${err?.message ?? err}`);
    }
  }

  // ── 2. Charge the deposit ────────────────────────────────────────────────
  // The security deposit is now a REAL second transaction, taken here right after the
  // rental capture (the two separate charges the customer is told to expect). It is
  // refunded at return, minus any damage adjustments the provider applies. Off-session
  // against the card the rental was paid with (or the profile's saved card).
  const depositAmount = Number(order.depositAmount ?? 0);
  if (!isBuy && depositAmount > 0 && order.depositStatus !== "charged") {
    try {
      const userRef = db.collection("users").doc(String(order.customerPhone));
      const user = (await userRef.get()).data() || {};
      // Prefer the card this rental was actually paid with; fall back to whatever the
      // profile has saved. createPaymentIntent sets setup_future_usage, so the rental
      // card is retained and reusable here.
      const customerId = rentalCustomerId || user.stripeCustomerId;
      const paymentMethodId = rentalPaymentMethodId || user.billingPaymentMethodId;
      if (!customerId || !paymentMethodId) {
        throw new Error("no saved card on file for this customer");
      }
      // Backfill the profile so a later charge/refund has the card directly.
      if (paymentMethodId !== user.billingPaymentMethodId || customerId !== user.stripeCustomerId) {
        await userRef.set(
          {stripeCustomerId: customerId, billingPaymentMethodId: paymentMethodId},
          {merge: true},
        );
      }
      // Card must be attached to the customer for an off-session charge.
      const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (!pm || (pm as any).customer !== customerId) {
        await stripe.paymentMethods.attach(paymentMethodId, {customer: customerId});
      }
      const res = await chargeSecurityDeposit(stripe, String(orderId), customerId, paymentMethodId, depositAmount);
      if (!res.ok) throw new Error(res.error);
      updates.depositPaymentMethodId = paymentMethodId;
      updates.depositPaymentIntentId = res.pi.id;
      updates.depositStatus = "charged";
      updates.depositChargedAmount = depositAmount;
      updates.depositChargedAt = new Date().toISOString();
    } catch (err: any) {
      // The bike IS delivered and the rental IS charged, so don't fail the whole
      // call — flag the deposit for follow-up instead.
      console.error(`markRentalDelivered: could not charge deposit for ${orderId}`, err);
      updates.depositStatus = "none";
      updates.depositError = String(err?.message ?? err);
    }
  }

  // ── 3. Rent-to-buy: open the installment schedule ────────────────────────
  // Period 1 was just captured above. The rest are billed one per due period by
  // chargeRentToBuyInstallments, off-session against the card retained at delivery.
  if (order.rentalType === "rentToBuy" && order.rentToBuyPlan) {
    const plan = order.rentToBuyPlan as RentToBuyPlan;
    const unit = plan.unit || "months";
    const cadence = plan.cadence || "monthly";
    const paymentMethodId = rentalPaymentMethodId || updates.depositPaymentMethodId || "";
    const fullyPaid = plan.periodsTotal <= 1;
    updates.billingSchedule = {
      periodsTotal: plan.periodsTotal,
      periodsCharged: 1,
      perPeriodAmount: plan.perPeriodAmount,
      unit,
      cadence,
      nextChargeAt: fullyPaid ? null : advanceByCadence(updates.deliveredAt, cadence),
      status: fullyPaid ? "completed" : "active",
      paymentMethodId,
      retryCount: 0,
      lastChargedAt: updates.deliveredAt,
    };
    if (fullyPaid) {
      updates.rentToBuyOwned = true;
      updates.rentToBuyOwnedAt = updates.deliveredAt;
    }
  }

  // ── 4. Progress the assigned bike ────────────────────────────────────────
  // The bike was RESERVED when staff picked its number in Operations. Handing it over
  // moves it to its working state: a buy is SOLD (leaves the fleet for good); a rent /
  // rent-to-buy is now RENTED (freed again at return / payoff). Best-effort — a bike
  // write must never fail an order that is already delivered and charged.
  if (order.bikeId) {
    try {
      const bikeRef = db.collection("bikes").doc(String(order.bikeId));
      const durationLabel = order.durationValue ?
        `${order.durationValue} ${order.durationUnit ?? ""}`.trim() :
        null;
      await bikeRef.update({
        status: isBuy ? "sold" : "rented",
        rentedBy: order.customerPhone ?? null,
        rentedByName: order.customerName ?? null,
        rentedDate: order.startDate ?? nowIso.slice(0, 10),
        rentalDuration: durationLabel,
        expectedEndDate: order.expectedEndDate ?? null,
        // A sold bike has no live order; a rental keeps the link until it's returned.
        currentOrderId: isBuy ? null : String(orderId),
      });
      await bikeRef.collection("history").doc(String(orderId)).set({
        orderId: String(orderId),
        model: order.bikeModel ?? null,
        bikeNo: order.bikeNo ?? null,
        rentedBy: order.customerPhone ?? null,
        rentedByName: order.customerName ?? null,
        rentedDate: order.startDate ?? nowIso.slice(0, 10),
        rentalDuration: durationLabel ?? "",
        expectedEndDate: order.expectedEndDate ?? null,
        rentalType: order.rentalType ?? "rent",
        // A buy never comes back, so close its history row out immediately.
        ...(isBuy ? {returnedDate: nowIso.slice(0, 10)} : {}),
      }, {merge: true});
    } catch (err) {
      console.warn(`markRentalDelivered: could not progress bike ${order.bikeId} for ${orderId}`, err);
    }
  }

  await orderRef.update(updates);
  return {
    success: true,
    chargedAmount: updates.chargedAmount ?? null,
    depositStatus: updates.depositStatus ?? order.depositStatus ?? "none",
    depositError: updates.depositError ?? null,
  };
});

/**
 * Bike returned. Completes the rental, settles the deposit, and emails the customer.
 *
 * The deposit was charged in full at delivery. On return the provider may apply damage
 * `adjustments` (each a note + amount); those are subtracted from the deposit and the
 * BALANCE is refunded to the card immediately. A thank-you + refund-breakdown email
 * goes out. (Legacy orders still on the old card-hold model — depositStatus 'secured' —
 * fall back to the 2-day release window instead of a refund.)
 */
export const markRentalReturned = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, returnNotes, returnPhotoPaths, adjustments: rawAdjustments} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const orderRef = db.collection("orders").doc(String(orderId));
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  const now = new Date();
  const releaseAt = new Date(now.getTime() + DEPOSIT_RELEASE_DELAY_DAYS * 24 * 60 * 60 * 1000);

  const updates: Record<string, any> = {
    status: OrderStatus.COMPLETED,
    completedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    conditionAtReturn: {
      notes: typeof returnNotes === "string" ? returnNotes.trim() : "",
      photoPaths: Array.isArray(returnPhotoPaths) ? returnPhotoPaths.slice(0, 12) : [],
      recordedAt: now.toISOString(),
      recordedBy: order.providerId ?? null,
    },
  };

  // Normalise the provider's damage adjustments and cap the total at the deposit — we
  // only ever hold back what was collected; anything beyond it is a separate matter.
  // Base the refund on what was actually charged (falls back to the quoted amount for
  // legacy holds that were never charged).
  const deposit = Number(order.depositChargedAmount ?? order.depositAmount ?? 0);
  const adjustments: { note: string; amount: number }[] = (Array.isArray(rawAdjustments) ? rawAdjustments : [])
    .map((a: any) => ({note: String(a?.note ?? "").trim(), amount: Math.max(0, Number(a?.amount) || 0)}))
    .filter((a: { note: string; amount: number }) => a.amount > 0);
  const adjustmentTotalRaw = Math.round(adjustments.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  const adjustmentTotal = Math.min(adjustmentTotalRaw, deposit);
  const refundTarget = Math.round(Math.max(0, deposit - adjustmentTotal) * 100) / 100;
  // Whether a deposit was actually charged here (vs. a legacy hold or a failed delivery
  // charge). Only then is there something to refund and report.
  const depositWasCharged = order.depositStatus === "charged" && !!order.depositPaymentIntentId;
  let refundAmount = 0; // what actually went back to the customer
  let depositError: string | null = null;

  if (depositWasCharged) {
    // Refund the balance to the card the deposit was taken from.
    if (refundTarget > 0) {
      const config = await getConfig();
      const stripe = getStripe(config.stripe.secretKey);
      const res = await refundChargedDeposit(stripe, String(orderId), order.depositPaymentIntentId, refundTarget);
      if (res.ok) {
        updates.depositRefundId = res.refundId;
        refundAmount = refundTarget;
      } else {
        // Bike is still back in stock — surface the refund failure for manual follow-up
        // rather than failing the return.
        console.error(`markRentalReturned: deposit refund failed for ${orderId}`, res.error);
        depositError = res.error;
        updates.depositError = depositError;
      }
    }
    updates.depositStatus = "refunded";
    updates.depositRefundedAmount = refundAmount;
    updates.depositRefundedAt = now.toISOString();
    updates.depositAdjustments = adjustments;
    updates.depositAdjustmentTotal = adjustmentTotal;
  } else if (order.depositStatus === "secured") {
    // Legacy hold model: no charge to refund, so keep the 2-day release window.
    updates.depositReleaseAt = releaseAt.toISOString();
  }

  // Put the bike back into available stock.
  if (order.bikeId) {
    try {
      await db.collection("bikes").doc(String(order.bikeId)).update({
        status: "available",
        rentedBy: null,
        rentedDate: null,
        rentalDuration: null,
        expectedEndDate: null,
        currentOrderId: null,
      });
      await db.collection("bikes").doc(String(order.bikeId)).collection("history")
        .doc(String(orderId)).set({returnedDate: now.toISOString().slice(0, 10)}, {merge: true});
    } catch (err) {
      console.warn(`markRentalReturned: could not free bike ${order.bikeId}`, err);
    }
  }

  await orderRef.update(updates);

  // Thank-you + deposit settlement email (best-effort). Show the deposit breakdown only
  // when a charge was actually refunded; otherwise it's a plain thank-you (a legacy hold,
  // a no-deposit rental, or a refund that failed and needs manual follow-up).
  const showBreakdown = depositWasCharged && !depositError;
  await emailRentalReturned(order, showBreakdown ? deposit : 0, adjustments, adjustmentTotal, refundAmount).catch(() => {});
  if (showBreakdown && deposit > 0) {
    await notifyCustomer(
      order.customerPhone, String(orderId),
      "Thanks for riding with Foodyzz",
      refundAmount > 0 ?
        `Your $${refundAmount.toFixed(2)} deposit refund is on its way.` :
        "Your rental is complete — see your email for the deposit breakdown.",
      "DEPOSIT_REFUNDED",
    ).catch(() => {});
  }

  return {
    success: true,
    depositRefunded: refundAmount,
    depositAdjustmentTotal: adjustmentTotal,
    adjustments,
    depositError,
    depositReleaseAt: updates.depositReleaseAt ?? null,
  };
});

// Thank-you email sent when a bike is returned: itemises any damage adjustments and
// states the deposit balance refunded to the customer.
async function emailRentalReturned(
  order: any, deposit: number, adjustments: { note: string; amount: number }[],
  adjustmentTotal: number, refundAmount: number,
): Promise<void> {
  const money = (n: number) => `$${Number(n || 0).toFixed(2)}`;
  const name = String(order.customerName || "").split(" ")[0];
  let bodyHtml = "";
  if (deposit > 0) {
    const adjRows = adjustments.length ?
      adjustments.map((a) => `
          <tr>
            <td style="padding:6px 0;color:#475569;font-size:14px">${escapeHtml(a.note || "Adjustment")}</td>
            <td style="padding:6px 0;text-align:right;color:#be123c;font-size:14px">−${money(a.amount)}</td>
          </tr>`).join("") :
      `<tr><td style="padding:6px 0;color:#475569;font-size:14px">No adjustments</td>
             <td style="padding:6px 0;text-align:right;color:#16a34a;font-size:14px">$0.00</td></tr>`;
    bodyHtml = `
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:8px 0">
        <tr>
          <td style="padding:6px 0;color:#0f172a;font-size:14px;font-weight:bold">Security deposit</td>
          <td style="padding:6px 0;text-align:right;color:#0f172a;font-size:14px;font-weight:bold">${money(deposit)}</td>
        </tr>
        ${adjRows}
        <tr>
          <td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:bold;border-top:1px solid #e2e8f0">Refunded to your card</td>
          <td style="padding:8px 0;text-align:right;color:#16a34a;font-size:15px;font-weight:bold;border-top:1px solid #e2e8f0">${money(refundAmount)}</td>
        </tr>
      </table>
      <p style="margin:12px 0 0;color:#94a3b8;font-size:13px;line-height:1.6">
        ${adjustmentTotal > 0 ?
    `We applied ${money(adjustmentTotal)} in adjustments for the items above and refunded the ${money(refundAmount)} balance.` :
    "Your full deposit has been refunded — refunds usually land in a few business days."}
      </p>`;
  }
  await emailCustomer(order, "Thanks for renting with Foodyzz 🚲", {
    title: "Thanks for riding with Foodyzz!",
    intro: `Hi ${name || "there"} — thanks for returning your bike and renting with Foodyzz. ` +
      (deposit > 0 ? "Here's your deposit breakdown." : "We hope to see you again soon."),
    bodyHtml,
  });
}

/**
 * Charge some or all of a secured deposit — damage, a missing bike, or an unreturned
 * rental. Off-session against the card retained at delivery.
 */
export const chargeDeposit = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId, amount, reason} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);
  const orderRef = db.collection("orders").doc(String(orderId));
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = snap.data() as any;

  if (order.depositStatus !== "secured") {
    throw new HttpsError("failed-precondition", `Deposit is '${order.depositStatus ?? "none"}', not secured.`);
  }
  const max = Number(order.depositAmount ?? 0);
  const charge = Math.min(Number(amount ?? max), max);
  if (!(charge > 0)) throw new HttpsError("invalid-argument", "Charge amount must be greater than zero.");

  const user = (await db.collection("users").doc(String(order.customerPhone)).get()).data() || {};
  const customerId = user.stripeCustomerId;
  const paymentMethodId = order.depositPaymentMethodId || user.billingPaymentMethodId;
  if (!customerId || !paymentMethodId) {
    throw new HttpsError("failed-precondition", "No saved card on file for this customer.");
  }

  try {
    // Idempotency key: guards against a double-tap/retry that races before
    // depositStatus flips to "charged" (which otherwise blocks a second charge).
    const chargeCents = Math.round(charge * 100);
    const pi = await stripe.paymentIntents.create({
      amount: chargeCents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: `Foodyzz security deposit — ${String(reason || "bike condition").slice(0, 180)}`,
      metadata: {orderId: String(orderId), kind: "security_deposit"},
    }, {idempotencyKey: `${orderId}:deposit:${chargeCents}`});
    await orderRef.update({
      depositStatus: "charged",
      depositChargedAmount: charge,
      depositPaymentIntentId: pi.id,
      depositChargedAt: new Date().toISOString(),
      depositChargeReason: String(reason || ""),
    });
    await notifyCustomer(
      order.customerPhone, String(orderId),
      "Deposit charged",
      `$${charge.toFixed(2)} of your security deposit was charged. Reason: ${reason || "bike condition"}.`,
      "DEPOSIT_CHARGED",
    ).catch(() => {});
    return {success: true, charged: charge};
  } catch (err: any) {
    throw new HttpsError("internal", `Could not charge the deposit: ${err?.message ?? err}`);
  }
});

/**
 * Clears deposit obligations whose 2-day post-return window has lapsed. Runs hourly
 * so a release lands close to its due time rather than at an arbitrary daily hour.
 */
export const scheduledDepositRelease = onSchedule({schedule: "0 * * * *", memory: "512MiB", timeoutSeconds: 540}, async () => {
  const nowIso = new Date().toISOString();
  const due = await db.collection("orders")
    .where("depositStatus", "==", "secured")
    .where("depositReleaseAt", "<=", nowIso)
    .limit(200)
    .get();

  if (due.empty) return;
  for (const doc of due.docs) {
    const order = doc.data() as any;
    try {
      await doc.ref.update({
        depositStatus: "released",
        depositReleasedAt: nowIso,
      });
      await notifyCustomer(
        order.customerPhone, doc.id,
        "Deposit released",
        `Your $${Number(order.depositAmount ?? 0).toFixed(2)} security deposit has been released. Thanks for riding with Foodyzz.`,
        "DEPOSIT_RELEASED",
      ).catch(() => {});
    } catch (err) {
      console.error(`scheduledDepositRelease: failed for ${doc.id}`, err);
    }
  }
  console.log(`scheduledDepositRelease: released ${due.size} deposit(s)`);
});

// ── Rent-to-buy installment billing ─────────────────────────────────────────
// A rent-to-buy plan is billed one period at a time. Period 1 is captured at delivery
// (markRentalDelivered); every later period is charged off-session by the hourly
// chargeRentToBuyInstallments cron against the card retained at delivery. When the last
// period clears, ownership transfers and the deposit is released.

/**
 * Charges one or more consecutive rent-to-buy periods off-session against the retained
 * card. Shared by the cron (1 period) and early payoff (all remaining). The idempotency
 * key is scoped to the exact period range, so a cron re-run or retry can never
 * double-charge the same month(s).
 */
async function chargeRentToBuyPeriods(
  stripe: Stripe,
  orderRef: DocumentReference,
  order: any,
  periodsToCharge: number,
  label: string,
): Promise<{ ok: true; pi: Stripe.PaymentIntent } | { ok: false; error: string }> {
  const sched = order.billingSchedule as BillingSchedule;
  const fromPeriod = sched.periodsCharged + 1;
  const toPeriod = Math.min(sched.periodsTotal, sched.periodsCharged + periodsToCharge);
  const count = toPeriod - sched.periodsCharged;
  if (count <= 0) return {ok: false, error: "nothing left to charge"};
  const cents = Math.round(sched.perPeriodAmount * count * 100);

  const user = (await db.collection("users").doc(String(order.customerPhone)).get()).data() || {};
  const customerId = user.stripeCustomerId;
  const paymentMethodId = sched.paymentMethodId || order.depositPaymentMethodId || user.billingPaymentMethodId;
  if (!customerId || !paymentMethodId) return {ok: false, error: "no saved card on file for this customer"};

  try {
    const pi = await stripe.paymentIntents.create({
      amount: cents,
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true,
      off_session: true,
      description: `Foodyzz rent-to-buy ${label} — period ${fromPeriod}${toPeriod > fromPeriod ? `–${toPeriod}` : ""} of ${sched.periodsTotal}`,
      metadata: {
        orderId: orderRef.id,
        kind: "rent_to_buy_installment",
        fromPeriod: String(fromPeriod),
        toPeriod: String(toPeriod),
      },
    }, {idempotencyKey: `${orderRef.id}:rtb:${fromPeriod}-${toPeriod}`});
    return {ok: true, pi};
  } catch (err: any) {
    return {ok: false, error: String(err?.message ?? err)};
  }
}

/**
 * The last period cleared (or an early payoff completed): mark the order owned, refund
 * the security deposit, take the bike out of the fleet, and notify the customer.
 * `stripe` is passed so a charged deposit can be refunded; omit it only where no client
 * is available (the deposit then just flips to refunded without a Stripe call).
 */
async function completeRentToBuyOwnership(orderRef: DocumentReference, order: any, nowIso: string, stripe?: Stripe): Promise<void> {
  const sched = order.billingSchedule as BillingSchedule;
  const updates: Record<string, any> = {
    "billingSchedule.status": "completed",
    "billingSchedule.nextChargeAt": null,
    "billingSchedule.periodsCharged": sched.periodsTotal,
    "billingSchedule.retryCount": 0,
    "billingSchedule.lastError": "",
    "rentToBuyOwned": true,
    "rentToBuyOwnedAt": nowIso,
    "status": OrderStatus.COMPLETED,
    "completedAt": nowIso,
    "updatedAt": nowIso,
  };
  // They own the bike now — no obligation left, so return the deposit.
  if (order.depositStatus === "charged" && order.depositPaymentIntentId) {
    const amount = Number(order.depositChargedAmount ?? order.depositAmount ?? 0);
    if (stripe && amount > 0) {
      const res = await refundChargedDeposit(stripe, orderRef.id, order.depositPaymentIntentId, amount);
      if (res.ok) updates.depositRefundId = res.refundId;
      else console.error(`completeRentToBuyOwnership: deposit refund failed for ${orderRef.id}`, res.error);
    }
    updates.depositStatus = "refunded";
    updates.depositRefundedAmount = amount;
    updates.depositRefundedAt = nowIso;
  } else if (order.depositStatus === "secured") {
    // Legacy hold model: nothing was charged, just release the obligation.
    updates.depositStatus = "released";
    updates.depositReleasedAt = nowIso;
  }
  await orderRef.update(updates);

  // The bike leaves rentable stock — it belongs to the customer.
  if (order.bikeId) {
    await db.collection("bikes").doc(String(order.bikeId)).update({
      status: "sold",
      ownedBy: order.customerPhone,
      soldAt: nowIso,
      rentedBy: null,
      currentOrderId: null,
      expectedEndDate: null,
    }).catch((e) => console.warn(`completeRentToBuyOwnership: bike ${order.bikeId} update failed`, e));
  }

  await notifyCustomer(
    order.customerPhone, orderRef.id,
    "You own your bike! 🎉",
    "Your final rent-to-buy payment is in — the bike is officially yours.",
    "RTB_OWNED",
  ).catch(() => {});
  await emailCustomer(order, "You now own your Foodyzz bike 🎉", {
    title: "The bike is yours",
    intro: `Congratulations${order.customerName ? `, ${String(order.customerName).split(" ")[0]}` : ""} — ` +
      "your rent-to-buy plan is paid in full and the bike is now yours to keep. " +
      "Any security deposit held has been released.",
  }).catch(() => {});
}

// Customer receipt for a single cleared installment.
async function emailRentToBuyInstallment(order: any, sched: BillingSchedule, periodJustPaid: number): Promise<void> {
  const remaining = sched.periodsTotal - periodJustPaid;
  await emailCustomer(order, `Foodyzz rent-to-buy payment ${periodJustPaid}/${sched.periodsTotal}`, {
    title: "Payment received",
    intro: `We charged $${Number(sched.perPeriodAmount).toFixed(2)} for month ${periodJustPaid} of ${sched.periodsTotal} on your rent-to-buy plan.`,
    bodyHtml: `<p style="margin:0;color:#475569;font-size:14px;line-height:1.6">${
      remaining > 0 ?
        `${remaining} payment${remaining === 1 ? "" : "s"} left before the bike is yours.` :
        "That was your final payment — the bike is now yours!"
    }</p>`,
  });
}

// Urgent admin alert after two failed attempts on the same period.
async function emailAdminRentToBuyFailure(orderId: string, order: any, sched: BillingSchedule, errMsg: string): Promise<void> {
  const adminEmail = await getAdminNotifyEmail();
  const ref = orderId.replace("order_", "#");
  const period = sched.periodsCharged + 1;
  await sendEmail(
    adminEmail,
    `🚨 URGENT: Rent-to-buy payment failed — ${ref}`,
    emailLayout({
      brand: "Foodyzz Admin",
      accent: "#be123c",
      title: "Rent-to-buy payment failed after 2 attempts",
      intro: `The automatic payment for order ${ref} failed twice and needs manual follow-up.`,
      bodyHtml: `<table style="width:100%;border-collapse:collapse;font-size:14px;color:#0f172a">
        <tr><td style="padding:4px 0;color:#475569">Customer</td><td style="text-align:right">${escapeHtml(String(order.customerName || ""))} (${escapeHtml(String(order.customerPhone || ""))})</td></tr>
        <tr><td style="padding:4px 0;color:#475569">Period</td><td style="text-align:right">${period} of ${sched.periodsTotal}</td></tr>
        <tr><td style="padding:4px 0;color:#475569">Amount</td><td style="text-align:right">$${Number(sched.perPeriodAmount).toFixed(2)}</td></tr>
        <tr><td style="padding:4px 0;color:#475569">Last error</td><td style="text-align:right">${escapeHtml(errMsg.slice(0, 200))}</td></tr>
      </table>`,
    }),
  );
}

/**
 * Hourly: charge every rent-to-buy installment that has come due. Two failed attempts
 * on a period escalate it to `past_due` (auto-retry stops, admin is alerted for manual
 * follow-up); the last successful period transfers ownership.
 */
export const chargeRentToBuyInstallments = onSchedule({schedule: "0 * * * *", memory: "512MiB", timeoutSeconds: 540}, async () => {
  const nowIso = new Date().toISOString();
  const due = await db.collection("orders")
    .where("billingSchedule.status", "==", "active")
    .where("billingSchedule.nextChargeAt", "<=", nowIso)
    .limit(100)
    .get();

  if (due.empty) return;
  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);

  for (const doc of due.docs) {
    const order = {id: doc.id, ...(doc.data() as any)};
    const sched = order.billingSchedule as BillingSchedule;
    try {
      const res = await chargeRentToBuyPeriods(stripe, doc.ref, order, 1, "installment");
      if (res.ok) {
        const periodJustPaid = sched.periodsCharged + 1;
        if (periodJustPaid >= sched.periodsTotal) {
          await completeRentToBuyOwnership(doc.ref, order, nowIso, stripe);
        } else {
          await doc.ref.update({
            "billingSchedule.periodsCharged": periodJustPaid,
            "billingSchedule.nextChargeAt": advanceByCadence(sched.nextChargeAt || nowIso, sched.cadence || "monthly"),
            "billingSchedule.retryCount": 0,
            "billingSchedule.lastError": "",
            "billingSchedule.lastChargedAt": nowIso,
            "billingSchedule.lastPaymentIntentId": res.pi.id,
            "updatedAt": nowIso,
          });
          await notifyCustomer(
            order.customerPhone, doc.id,
            "Rent-to-buy payment received",
            `$${Number(sched.perPeriodAmount).toFixed(2)} paid — ${sched.periodsTotal - periodJustPaid} month(s) to go.`,
            "RTB_PAYMENT",
          ).catch(() => {});
          await emailRentToBuyInstallment(order, sched, periodJustPaid).catch(() => {});
        }
      } else {
        const attempts = (sched.retryCount || 0) + 1;
        if (attempts >= 2) {
          // Two strikes: stop auto-retrying and hand off to a human.
          await doc.ref.update({
            "billingSchedule.status": "past_due",
            "billingSchedule.retryCount": attempts,
            "billingSchedule.lastError": res.error,
            "billingSchedule.nextChargeAt": null,
            "updatedAt": nowIso,
          });
          await emailAdminRentToBuyFailure(doc.id, order, sched, res.error).catch(() => {});
          await notifyCustomer(
            order.customerPhone, doc.id,
            "Payment issue on your bike plan",
            "We couldn't process your rent-to-buy payment. Please update your card — our team will reach out.",
            "RTB_FAILED",
          ).catch(() => {});
        } else {
          // First failure: retry in 24h.
          await doc.ref.update({
            "billingSchedule.retryCount": attempts,
            "billingSchedule.lastError": res.error,
            "billingSchedule.nextChargeAt": addDaysIso(nowIso, 1),
            "updatedAt": nowIso,
          });
        }
      }
    } catch (err) {
      console.error(`chargeRentToBuyInstallments: failed for ${doc.id}`, err);
    }
  }
  console.log(`chargeRentToBuyInstallments: processed ${due.size} order(s)`);
});

/**
 * Early payoff: charge every remaining rent-to-buy period at once and transfer
 * ownership. Customer-initiated from My Rentals. No cancellation/refund path — those
 * are handled manually, per policy.
 */
export const payoffRentToBuy = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);
  const orderRef = db.collection("orders").doc(String(orderId));
  const snap = await orderRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Order not found.");
  const order = {id: orderRef.id, ...(snap.data() as any)};

  if (order.rentalType !== "rentToBuy" || !order.billingSchedule) {
    throw new HttpsError("failed-precondition", "This order has no rent-to-buy plan.");
  }
  const sched = order.billingSchedule as BillingSchedule;
  if (sched.status === "completed" || order.rentToBuyOwned) {
    return {success: true, alreadyOwned: true};
  }
  const remaining = sched.periodsTotal - sched.periodsCharged;
  const nowIso = new Date().toISOString();
  if (remaining <= 0) {
    await completeRentToBuyOwnership(orderRef, order, nowIso, stripe);
    return {success: true, alreadyOwned: true};
  }

  const res = await chargeRentToBuyPeriods(stripe, orderRef, order, remaining, "early payoff");
  if (!res.ok) throw new HttpsError("internal", `Could not complete payoff: ${res.error}`);

  await completeRentToBuyOwnership(orderRef, order, nowIso);
  const amount = Math.round(sched.perPeriodAmount * remaining * 100) / 100;
  return {success: true, charged: amount, periods: remaining};
});

/**
 * Records the card used on an order's PaymentIntent onto the customer's profile.
 * Called by the client right after payment succeeds, so a saved card shows up
 * immediately without depending on webhook configuration. Idempotent.
 */
export const recordOrderCard = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Authentication required.");
  const {orderId} = request.data;
  if (!orderId) throw new HttpsError("invalid-argument", "Missing orderId.");

  const config = await getConfig();
  const stripe = getStripe(config.stripe.secretKey);
  const orderSnap = await db.collection("orders").doc(String(orderId)).get();
  const order = orderSnap.data();
  const paymentIntentId = order?.paymentIntentId;
  const phone = order?.customerPhone || request.auth.token.phone_number;
  if (!paymentIntentId || !phone) return {saved: false};

  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    const paymentMethodId = typeof pi.payment_method === "string" ? pi.payment_method : "";
    const customerId = typeof pi.customer === "string" ? pi.customer : "";
    if (!paymentMethodId) return {saved: false};

    const card = await stripe.paymentMethods.retrieve(paymentMethodId);
    await db.collection("users").doc(String(phone)).set({
      ...(customerId ? {stripeCustomerId: customerId} : {}),
      billingPaymentMethodId: paymentMethodId,
      billingCardLast4: card.card?.last4 ?? null,
      billingCardBrand: card.card?.brand ?? null,
      billingCardExpMonth: card.card?.exp_month ?? null,
      billingCardExpYear: card.card?.exp_year ?? null,
    }, {merge: true});
    return {saved: true, last4: card.card?.last4 ?? null};
  } catch (err: any) {
    console.warn(`recordOrderCard: failed for ${orderId}`, err);
    return {saved: false};
  }
});

export const onOrderIdDocsRequested = onDocumentUpdated("orders/{orderId}", async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  // Only on the transition unset -> set, so a later order edit never re-notifies.
  if (before?.idRequestedAt || !after.idRequestedAt) return;

  const orderId = event.params.orderId;
  const store = after.providerName || "FoodyzzHQ";
  // Push — tapping it deep-links the customer app straight to Account, where the
  // upload card lives (see the ID_DOCS_REQUESTED branch in the app's tap handler).
  try {
    await notifyCustomer(
      after.customerPhone,
      orderId,
      "Action needed: verify your ID",
      `${store} needs your driver license (front and back) and proof of address before your bike ` +
      "can be delivered. Tap to open Account and upload them.",
      "ID_DOCS_REQUESTED",
    );
  } catch (err) {
    // Non-fatal: the request itself is already recorded on the order.
    console.warn(`onOrderIdDocsRequested: notify failed for ${orderId}`, err);
  }

  // ...and email, so the customer is reached on both channels. A push can be
  // disabled, missed or land on a device they're not holding; the email is the
  // durable copy of the request. Independently try/caught so a missing SMTP
  // config or a bounced address never takes the push down with it.
  try {
    const userSnap = await db.collection("users").doc(String(after.customerPhone)).get();
    const email = userSnap.data()?.email;
    if (email) {
      await sendEmail(
        String(email),
        "Action needed: upload your ID & proof of address",
        emailLayout({
          brand: "Foodyzz",
          accent: "#6366f1",
          title: "We need your ID before delivery",
          intro:
            `${store} is preparing order ${orderId.replace("order_", "#")}, and we need two documents ` +
            "before the bike can go out.",
          bodyHtml: `
            <ul style="margin:0 0 16px;padding-left:20px;color:#475569;font-size:14px;line-height:1.8">
              <li>Your <strong>driver license</strong> — front and back</li>
              <li>A <strong>proof of address</strong> — utility bill, bank statement or lease</li>
            </ul>
            <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6">
              Open the Foodyzz app and go to <strong>Account → Identity documents</strong> to upload all three
              photos. FoodyzzHQ verifies them, usually within a few minutes, and your order moves straight on
              to delivery.
            </p>`,
        }),
      );
    } else {
      console.warn(`onOrderIdDocsRequested: no email on file for ${after.customerPhone}`);
    }
  } catch (err) {
    console.warn(`onOrderIdDocsRequested: email failed for ${orderId}`, err);
  }
});

// The other half of the ID loop: the customer has just uploaded (or replaced)
// their documents, so tell FoodyzzHQ there's something to review. Fires on the
// users/{phone} write where BOTH documents become present-and-unreviewed, which
// covers a first upload and a re-submission (saveDocumentToProfile clears
// reviewedAt on every save). The uploadedAt comparison is what keeps an unrelated
// profile write (fcmToken refresh, address edit) from re-notifying.
export const onCustomerDocsUploaded = onDocumentWritten("users/{phone}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();
  if (!after) return;

  const complete = (u: any) =>
    !!u?.driverLicense?.frontPath && !!u?.driverLicense?.backPath && !!u?.addressProof?.frontPath;
  if (!complete(after)) return;

  // Only on a NEW submission awaiting review.
  const submittedAt = `${after.driverLicense?.uploadedAt || ""}|${after.addressProof?.uploadedAt || ""}`;
  const wasSubmittedAt = `${before?.driverLicense?.uploadedAt || ""}|${before?.addressProof?.uploadedAt || ""}`;
  if (submittedAt === wasSubmittedAt) return;
  if (after.driverLicense?.reviewedAt && after.addressProof?.reviewedAt) return;

  const phone = event.params.phone;
  const name = after.name || phone;

  // Route it to whoever is actually waiting: the stores holding this customer's
  // open orders that asked for documents and haven't verified them yet.
  try {
    const ordersSnap = await db.collection("orders")
      .where("customerPhone", "==", phone)
      .orderBy("createdAt", "desc")
      .limit(10)
      .get();

    const notified = new Set<string>();
    for (const doc of ordersSnap.docs) {
      const order = doc.data() as RentalOrder & { idRequestedAt?: string; docsVerifiedAt?: string };
      if (order.docsVerifiedAt) continue;
      if (["completed", "cancelled", "delivered"].includes(String(order.status))) continue;
      const providerId = order.providerId;
      if (!providerId || providerId === "broadcast" || notified.has(providerId)) continue;
      notified.add(providerId);
      await notifyProvider(
        providerId,
        "ID documents uploaded",
        `${name} uploaded their driver license and proof of address for order ` +
        `${doc.id.replace("order_", "#")}. Review them to release the bike.`,
        "ID_DOCS_UPLOADED",
        doc.id,
      );
    }

    // Nothing order-specific pending → still tell the admin desk, so a proactive
    // upload doesn't sit unreviewed.
    if (notified.size === 0) {
      await notifyAdmin(
        "ID documents uploaded",
        `${name} uploaded their driver license and proof of address.`,
        "ID_DOCS_UPLOADED",
        {userPhone: phone},
      );
    }
  } catch (err) {
    console.error("onCustomerDocsUploaded failed:", err);
  }
});

// NOTE: customer notification on the → DELIVERED transition is handled by
// onOrderDeliveryStatusNotify (the DELIVERED case), which sends a richer message
// (amount charged / deposit held) plus an email receipt. A previous
// onOrderDeliveredNotifyCustomer trigger here fired on the same transition and
// produced a duplicate push + double badge increment; it was removed.

export const updateProviderLocationAndStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Auth required.");
  const {orderId, lat, lng, providerCurrentStatus} = request.data;
  const orderRef = db.collection("orders").doc(orderId);
  const order = (await orderRef.get()).data() as RentalOrder;

  // Location is best-effort real GPS from the provider's device. It may be absent
  // when the provider denies the permission — only persist the map pin when we have
  // valid coordinates so we never write undefined/garbage or misfire auto-arrival.
  const hasCoords = typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng);
  const updates: any = {providerCurrentStatus, updatedAt: new Date().toISOString()};
  if (hasCoords) {
    updates.providerLocation = {lat, lng, timestamp: new Date().toISOString()};
  }
  let newStatus = order.status;

  // 1. Manually triggered status changes from provider app actions
  const statusValues = Object.values(OrderStatus) as string[];
  if (statusValues.includes(providerCurrentStatus)) {
    newStatus = providerCurrentStatus as OrderStatus;
  }

  // Customer messaging for every delivery state is owned by
  // onOrderDeliveryStatusNotify, which fires off the order document — notifying
  // here as well would send each one twice.

  // 2. Automatic proximity-based status detection (auto-arrival). Compare the real
  // provider GPS against the order's precise pickup coordinates (customerLat/Lng),
  // falling back to a zip-approximation only when they're missing. Skipped entirely
  // when we have no provider fix, so denying location just means manual arrival.
  if (hasCoords) {
    const custLat = (order as any).customerLat;
    const custLng = (order as any).customerLng;
    const customerCoords = (typeof custLat === "number" && typeof custLng === "number" &&
      Number.isFinite(custLat) && Number.isFinite(custLng)) ?
      {lat: custLat, lng: custLng} :
      getCoordsFromAddress(order.customerAddress);
    const dist = calculateDistance(`${lat},${lng}`, `${customerCoords.lat},${customerCoords.lng}`);
    if (newStatus === OrderStatus.EN_ROUTE_DELIVERY && dist <= PROXIMITY_THRESHOLD_AT_LOCATION_MILES) {
      newStatus = OrderStatus.AT_DELIVERY;
      await notifyCustomer(order.customerPhone, orderId, "Provider Arrived!", "Your provider is here.", "PROVIDER_AT_LOCATION");
    } else if (newStatus === OrderStatus.EN_ROUTE_DELIVERY && dist <= PROXIMITY_THRESHOLD_AT_LOCATION_MILES) {
      newStatus = OrderStatus.AT_DELIVERY;
      await notifyCustomer(order.customerPhone, orderId, "Delivery Arrived!", "Your bike has arrived.", "PROVIDER_AT_LOCATION");
    }
  }

  if (newStatus !== order.status) updates.status = newStatus;
  await orderRef.update(updates);
  return {success: true, newStatus: updates.status};
});

export const autoSupportResponder = onDocumentCreated("supportMessages/{messageId}", async (event) => {
  const msg = event.data?.data();
  if (!msg || msg.senderPhone === "admin" || msg.senderPhone === "system") return;
  const text = msg.text.toLowerCase();
  let res = "";
  if (text.includes("payout") || text.includes("earnings")) res = "Hi! Payouts are processed on the 1st and 15th.";
  else if (text.includes("cancel") || text.includes("refund")) res = "Orders can be cancelled in the 'My Rentals' screen.";
  else if (text.includes("price") || text.includes("charge")) res = "Pricing is based on estimates. Final adjustments occur at pickup.";
  if (res) {
    const auto: SupportMessage = {userPhone: msg.userPhone, userName: msg.userName, userRole: msg.userRole, senderPhone: "system", senderName: "Foodyzz Bot", text: res, timestamp: new Date().toISOString(), isReadByAdmin: true};
    await db.collection("supportMessages").add(auto);
    await notifySupportUser(msg.userPhone, msg.userRole, "Automated Help", res, "ADMIN_SUPPORT_REPLY", "bot_" + event.params.messageId);
  }
});

export const bulkBroadcast = onCall({memory: "512MiB", timeoutSeconds: 300}, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) throw new HttpsError("permission-denied", "Unauthorized.");
  const {title, body, data, zipCode, target} = request.data;
  const col = target === "customers" ? "users" : "providers";
  let base: any = db.collection(col);
  if (target === "providers") base = base.where("onboarded", "==", true);
  if (zipCode) base = base.where("zipCode", "==", zipCode);

  // Stream the target collection in pages instead of loading the WHOLE collection
  // (and one giant messages array) into memory — a broadcast to "customers" with no
  // zip could otherwise pull every user at once. Each page is pushed to Expo before
  // the next is read. Ordering by document id gives a stable, index-free cursor.
  const PAGE = 500;
  // Cap retained tickets so a very large broadcast doesn't accumulate unbounded
  // ticket ids just for the receipt report; `sent`/`scanned`/`withToken` still count
  // every recipient, we just stop collecting per-recipient receipts past the cap.
  const RECEIPT_TICKET_CAP = 2000;
  const tickets: Array<{ id: string; ref?: DocumentReference }> = [];
  let scanned = 0;
  let withToken = 0;
  let sent = 0;
  let cursor: QueryDocumentSnapshot | null = null;

  for (;;) {
    let pageQ = base.orderBy(FieldPath.documentId()).limit(PAGE);
    if (cursor) pageQ = pageQ.startAfter(cursor);
    const snap = await pageQ.get();
    if (snap.empty) break;

    const messages: ExpoMessage[] = [];
    snap.forEach((d: any) => {
      scanned++;
      const tok = d.data().fcmToken;
      if (tok) {
        withToken++;
        messages.push({to: tok, title, body, data: {...data, type: "BULK", target, timestamp: Date.now().toString()}, ref: d.ref});
      }
    });

    if (messages.length) {
      // Only keep collecting receipt tickets while under the cap.
      const collect = tickets.length < RECEIPT_TICKET_CAP ? tickets : undefined;
      sent += await sendExpoPush(messages, collect);
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE) break;
  }

  let receipts: {
    delivered: number; errored: number; pending: number;
    errorsByCode: Record<string, number>; sample: string | null;
    // The non-delivered recipients (capped) so the admin can spot a specific
    // account — e.g. their own test device — that failed or is stale.
    problems: Array<{ recipient: string; status: string; error: string | null }>;
  } | null = null;

  if (tickets.length) {
    await new Promise((r) => setTimeout(r, 3000)); // give Expo a moment to resolve receipts
    const receiptMap = await fetchExpoReceipts(tickets.map((t) => t.id));
    let delivered = 0; let errored = 0; let pending = 0;
    const errorsByCode: Record<string, number> = {};
    let sample: string | null = null;
    const problems: Array<{ recipient: string; status: string; error: string | null }> = [];
    for (const t of tickets) {
      const recipient = t.ref?.id ?? "unknown";
      const r = receiptMap.get(t.id);
      if (!r) {
        pending++; if (problems.length < 25) problems.push({recipient, status: "pending", error: null}); continue;
      }
      if (r.status === "ok") {
        delivered++; continue;
      }
      errored++;
      const code = r.error ?? "Unknown";
      errorsByCode[code] = (errorsByCode[code] ?? 0) + 1;
      if (!sample) sample = r.message ?? code;
      if (problems.length < 25) problems.push({recipient, status: "failed", error: code});
    }
    receipts = {delivered, errored, pending, errorsByCode, sample, problems};
    console.log(`bulkBroadcast(${target}): scanned=${scanned} withToken=${withToken} accepted=${sent} receipts=`, receipts);
  }

  return {success: true, sent, scanned, withToken, receipts};
});

// ============================================================================
// SCHOOL-MANAGER SALES-REP PROGRAM
// Managers refer providers (the "fleet account") and earn a configurable cut of
// the platform fee on every order that provider fulfills. Codes are 6-char
// unambiguous alphanumerics; referralCodes/{CODE} guarantees uniqueness and lets
// the mobile apps resolve a code with a single read. See firestore.rules.
// ============================================================================

// ── Marketing-site contact form ──────────────────────────────────────────────
// Public HTTPS endpoint for the foodyzz.com "Contact Us" form. Validates, rate
// limits per IP, stores an audit record in `contactMessages` (server-only via
// rules default-deny), and emails the submission to the platform admin via the
// same cached SMTP transport the lifecycle emails use (apiConfigSecret/smtp;
// recipient = getAdminNotifyEmail(), i.e. adminEmail or rajshrestha@gmail.com).
const CONTACT_ALLOWED_ORIGINS = new Set([
  "https://foodyzz.com",
  "https://www.foodyzz.com",
  "http://localhost:8000", // local preview of website/
  "http://127.0.0.1:8000",
]);
const CONTACT_MAX_PER_HOUR = 5;
const CONTACT_TOPICS = new Set(["general", "plans", "order", "coverage", "partnership", "press"]);

export const contactForm = onRequest({cors: false, memory: "256MiB", timeoutSeconds: 30}, async (req, res) => {
  // CORS: reflect only known origins (the browser enforces; curl can always POST,
  // which is fine — the rate limit and validation still apply).
  const origin = String(req.headers.origin || "");
  if (CONTACT_ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ok: false, error: "Method not allowed."});
    return;
  }

  try {
    const body: any = req.body || {};

    // Honeypot: bots fill every field; humans never see this one. Pretend success
    // so the bot learns nothing.
    if (typeof body.website === "string" && body.website.trim() !== "") {
      res.json({ok: true});
      return;
    }

    const name = String(body.name || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().slice(0, 200);
    const phone = String(body.phone || "").trim().slice(0, 30);
    const topic = CONTACT_TOPICS.has(String(body.topic)) ? String(body.topic) : "general";
    const message = String(body.message || "").trim().slice(0, 4000);

    if (!name || !message || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      res.status(400).json({ok: false, error: "Please provide your name, a valid email, and a message."});
      return;
    }

    // Per-IP hourly rate limit via a transactional counter doc keyed by ip+hour.
    // Docs are tiny and self-partition by hour; a cleanup pass isn't necessary
    // but old docs can be TTL'd later if desired.
    const ip = String(req.headers["x-forwarded-for"] || req.ip || "unknown").split(",")[0].trim();
    const hourKey = new Date().toISOString().slice(0, 13); // e.g. 2026-07-24T20
    const rlRef = db.collection("contactRateLimits").doc(`${ip.replace(/[^a-zA-Z0-9.:]/g, "_")}_${hourKey}`);
    const allowed = await db.runTransaction(async (t) => {
      const snap = await t.get(rlRef);
      const count = (snap.data()?.count as number | undefined) ?? 0;
      if (count >= CONTACT_MAX_PER_HOUR) return false;
      t.set(rlRef, {count: count + 1, updatedAt: FieldValue.serverTimestamp()}, {merge: true});
      return true;
    });
    if (!allowed) {
      res.status(429).json({ok: false, error: "Too many messages — please try again in an hour."});
      return;
    }

    // Audit record (clients cannot read/write this collection — rules default-deny).
    const docRef = await db.collection("contactMessages").add({
      name, email, phone, topic, message,
      origin: origin || null,
      receivedAt: new Date().toISOString(),
    });

    // Email the admin. Plain-text-ish HTML; user content is escaped to keep the
    // email renderer from interpreting submitted markup.
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const adminEmail = await getAdminNotifyEmail();
    await sendEmail(
      adminEmail,
      `[Foodyzz Contact] ${topic}: ${name}`,
      emailLayout({
        brand: "Foodyzz",
        title: "New contact form message",
        intro: `Topic: ${esc(topic)} · Ref: ${docRef.id}`,
        bodyHtml:
          `<p style="margin:0 0 8px;color:#475569;font-size:14px"><b>From:</b> ${esc(name)} &lt;${esc(email)}&gt;${phone ? ` · ${esc(phone)}` : ""}</p>` +
          `<p style="margin:0 0 16px;color:#0f172a;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(message)}</p>` +
          `<p style="margin:0;color:#94a3b8;font-size:12px">Reply directly to the sender's email above.</p>`,
      }),
    );

    res.json({ok: true});
  } catch (err: any) {
    console.error("contactForm error:", err?.message || err);
    res.status(500).json({ok: false, error: "Could not send your message right now. Please email privacy@foodyzz.com."});
  }
});

// Sends a transactional email over SMTP. Credentials live in the server-only
// apiConfigSecret/smtp doc ({ host, port, secure, user, pass, from, adminEmail }),
// never in the client-readable config. Replaces the previous third-party (Resend)
// HTTP sender so all mail flows through the configured SMTP relay.
// Cached across warm invocations, mirroring getStripe/getConfig: the SMTP config
// (short TTL) and the transporter (rebuilt only when the config changes) so we don't
// do a Firestore read + open a fresh SMTP connection pool on every single email —
// delivery-flow + lifecycle emails can fire several per order.
const SMTP_TTL_MS = 60_000;
let smtpConfigCache: { cfg: any; at: number } | null = null;
let smtpTransporter: nodemailer.Transporter | null = null;
let smtpSig: string | null = null;

// Brand logo (CID attachment) — path + existence resolved ONCE at cold start rather
// than a synchronous fs.existsSync on every branded email. Path is relative to lib/
// at runtime → ../assets (deployed; firebase.json only ignores node_modules/.git).
const BRAND_LOGO_PATH = path.join(__dirname, "..", "assets", "foodyzz-logo.png");
const BRAND_LOGO_EXISTS = fs.existsSync(BRAND_LOGO_PATH);
if (!BRAND_LOGO_EXISTS) console.warn(`[sendEmail] brand logo missing at ${BRAND_LOGO_PATH}; branded emails will omit the inline logo`);

async function loadSmtpConfig(): Promise<any> {
  const now = Date.now();
  if (smtpConfigCache && now - smtpConfigCache.at < SMTP_TTL_MS) return smtpConfigCache.cfg;
  const snap = await db.doc("apiConfigSecret/smtp").get();
  const cfg: any = snap.exists ? snap.data() : null;
  if (!cfg?.host || !cfg?.user || !cfg?.pass) {
    throw new HttpsError("failed-precondition", "SMTP is not configured (apiConfigSecret/smtp).");
  }
  smtpConfigCache = {cfg, at: now};
  return cfg;
}

function getTransporter(cfg: any): nodemailer.Transporter {
  const port = Number(cfg.port) || 587;
  // `secure` true → implicit TLS (465). Honour the flag; default by port.
  const secure = cfg.secure === true || cfg.secure === "true" || port === 465;
  const sig = `${cfg.host}|${port}|${secure}|${cfg.user}|${cfg.pass}`;
  if (!smtpTransporter || smtpSig !== sig) {
    smtpTransporter = nodemailer.createTransport({
      host: String(cfg.host),
      port,
      secure,
      auth: {user: String(cfg.user), pass: String(cfg.pass)},
      pool: true, // reuse SMTP connections across sends on a warm instance
    });
    smtpSig = sig;
  }
  return smtpTransporter;
}

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const cfg = await loadSmtpConfig();
  const transporter = getTransporter(cfg);
  const from = cfg.from || cfg.user;
  // Inline the brand logo as a CID attachment (reliable across clients; unlike
  // data: URIs which Gmail strips) only when the HTML actually references it, so
  // plain emails don't carry a dangling attachment. Existence is resolved once at
  // cold start (BRAND_LOGO_EXISTS) rather than a synchronous fs.existsSync per send.
  // A missing asset degrades to a logo-less email (alt text shows), never fails.
  let attachments: { filename: string; path: string; cid: string }[] | undefined;
  if (html.includes("cid:foodyzzLogo") && BRAND_LOGO_EXISTS) {
    attachments = [{filename: "foodyzz-logo.png", path: BRAND_LOGO_PATH, cid: "foodyzzLogo"}];
  }
  try {
    await transporter.sendMail({from, to, subject, html, attachments});
  } catch (err: any) {
    throw new HttpsError("internal", `Email send failed: ${err?.message || err}`);
  }
}

// Where "new provider joined" admin notices go. Overridable via the smtp doc's
// adminEmail field; falls back to the platform owner's address.
async function getAdminNotifyEmail(): Promise<string> {
  try {
    const cfg = await loadSmtpConfig();
    if (cfg.adminEmail) return String(cfg.adminEmail);
  } catch {/* fall through to default */}
  return "rajshrestha@gmail.com";
}

// ── Shared branded email shell ───────────────────────────────────────────────
// Inline styles only (email clients ignore <style>). `accent` themes the app:
// Accent is the brand green for both apps (#86B54F, from the wordmark).
function emailLayout(opts: {
  title: string; intro: string; bodyHtml?: string;
  ctaText?: string; ctaUrl?: string; accent?: string; brand?: string;
}): string {
  const accent = opts.accent || "#86B54F";
  const brand = opts.brand || "Foodyzz";
  return `
  <div style="background:#f1f5f9;padding:24px 0;font-family:Arial,Helvetica,sans-serif">
    <div style="max-width:480px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:#ffffff;padding:20px 24px;text-align:center;border-bottom:3px solid ${accent}">
        <img src="cid:foodyzzLogo" alt="${brand}" width="180" style="display:inline-block;width:180px;max-width:60%;height:auto;border:0" />
      </div>
      <div style="padding:24px">
        <h2 style="margin:0 0 12px;color:#0f172a;font-size:20px">${opts.title}</h2>
        <p style="margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6">${opts.intro}</p>
        ${opts.bodyHtml || ""}
        ${opts.ctaText && opts.ctaUrl ? `
        <p style="margin:24px 0">
          <a href="${opts.ctaUrl}" style="background:${accent};color:#fff;font-weight:bold;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block">${opts.ctaText}</a>
        </p>` : ""}
        <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">You're receiving this because you signed up with ${brand}.</p>
      </div>
    </div>
  </div>`;
}

// ── Lifecycle emails ─────────────────────────────────────────────────────────

// Customer welcome (Foodyzz). The users doc is created at signup WITHOUT an email
// (just phone + onboarded:false); the address arrives when the customer completes
// their profile. So we fire on the write that first carries an email, guarded by
// a welcomeEmailSent flag so it sends exactly once. We also check here whether the
// customer side of a manager referral just completed a both-apps join.
export const onUserWriteLifecycleEmails = onDocumentWritten("users/{phone}", async (event) => {
  const before = event.data?.before?.data();
  const after = event.data?.after?.data();

  // Maintain admin-console aggregate counts (total users + pending-license queue).
  // Runs before the "deleted" early-return so a delete decrements the total.
  {
    const counts: Record<string, any> = {};
    if (!before && after) counts.usersTotal = FieldValue.increment(1);
    else if (before && !after) counts.usersTotal = FieldValue.increment(-1);
    const wasPending = isLicensePending(before);
    const isPending = isLicensePending(after);
    if (!wasPending && isPending) counts.pendingLicenses = FieldValue.increment(1);
    else if (wasPending && !isPending) counts.pendingLicenses = FieldValue.increment(-1);
    if (Object.keys(counts).length) {
      await bumpPlatformCounts(counts).catch((e) => console.error("platform counts (user) failed", e));
    }
  }

  if (!after) return; // deleted

  // Welcome to Foodyzz — fire only as onboarding COMPLETES (onboarded flips to
  // true, carrying the email). Gating on the transition — not merely "has email"
  // — is critical: otherwise every already-onboarded customer would be "welcomed"
  // the next time their doc is written (fcmToken refresh, profile edit) after this
  // deploys. welcomeEmailSent is a secondary guard against a rare re-transition.
  if (
    after.onboarded === true && before?.onboarded !== true &&
    after.email && after.welcomeEmailSent !== true && after.isAdmin !== true
  ) {
    try {
      await sendEmail(
        String(after.email),
        "Welcome to Foodyzz 🧺",
        emailLayout({
          brand: "Foodyzz",
          accent: "#6366f1",
          title: `Welcome${after.name ? `, ${after.name}` : ""}!`,
          intro: "Your Foodyzz account is ready. Schedule rental pickups and drop-offs, track every order in real time, and pay securely — all from your phone.",
          bodyHtml: "<p style=\"margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6\">Open the app to place your first order. We'll match you with a trusted local provider.</p>",
        }),
      );
      await event.data!.after.ref.update({welcomeEmailSent: true});
    } catch (err) {
      console.error("onUserWriteLifecycleEmails welcome error:", err);
    }
  }
});

// Provider welcome (FoodyzzHQ) + admin notice, on provider store creation. The
// providers doc carries the business email at creation, so we can send straight
// away. A welcomeEmailSent flag guards against re-sends if the doc is recreated.
export const onProviderCreatedLifecycleEmails = onDocumentCreated("providers/{providerId}", async (event) => {
  const prov = event.data?.data();
  if (!prov) return;

  // Aggregate count for the admin console (fires once, on provider creation).
  await bumpPlatformCounts({providersTotal: FieldValue.increment(1)})
    .catch((e) => console.error("platform counts (provider) failed", e));

  // Welcome to FoodyzzHQ.
  if (prov.email && prov.welcomeEmailSent !== true) {
    try {
      await sendEmail(
        String(prov.email),
        "Welcome to FoodyzzHQ 🚀",
        emailLayout({
          brand: "FoodyzzHQ",
          accent: "#f472b6",
          title: `Welcome aboard${prov.businessName ? `, ${prov.businessName}` : ""}!`,
          intro: "Your FoodyzzHQ provider account is live. You can now receive orders, manage dispatch and logistics, set your pricing, and track your earnings and payouts.",
          bodyHtml: "<p style=\"margin:0 0 16px;color:#475569;font-size:14px;line-height:1.6\">Head to the Dispatch tab to start claiming orders. Make sure your service area and pricing are set so customers can find you.</p>",
        }),
      );
      await event.data!.ref.update({welcomeEmailSent: true});
    } catch (err) {
      console.error("onProviderCreatedLifecycleEmails welcome error:", err);
    }
  }

  // Admin notice: a new provider joined.
  try {
    const adminEmail = await getAdminNotifyEmail();
    const phoneDigits = String(prov.phoneNumber || event.params.providerId.split("_")[0] || "").replace(/\D/g, "");
    await sendEmail(
      adminEmail,
      `New provider joined FoodyzzHQ: ${prov.businessName || phoneDigits || "Unknown"}`,
      emailLayout({
        brand: "FoodyzzHQ Admin",
        accent: "#0f172a",
        title: "New provider onboarded",
        intro: "A new provider just completed onboarding on FoodyzzHQ.",
        bodyHtml: `
          <table style="width:100%;border-collapse:collapse;font-size:13px;color:#0f172a">
            <tr><td style="padding:6px 0;color:#64748b">Business</td><td style="padding:6px 0;text-align:right;font-weight:700">${prov.businessName || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Email</td><td style="padding:6px 0;text-align:right">${prov.email || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Phone</td><td style="padding:6px 0;text-align:right">${phoneDigits || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Zip</td><td style="padding:6px 0;text-align:right">${prov.zipCode || "—"}</td></tr>
            <tr><td style="padding:6px 0;color:#64748b">Referred by</td><td style="padding:6px 0;text-align:right">${prov.referredByManagerId || "—"}</td></tr>
          </table>`,
      }),
    );
  } catch (err) {
    console.error("onProviderCreatedLifecycleEmails admin notice error:", err);
  }
});


// ── Staff admin claim ──────────────────────────────────────────────────────
//
// `admin: true` on the auth token is what unlocks staff access across the whole
// system: reading customer identity documents in Cloud Storage (storage.rules
// isAdmin()), apiConfig writes, stats / providerPerformance, bulkBroadcast.
// Until this function existed the claim was READ in three places and SET
// nowhere, so no account ever had it — which is why FoodyzzHQ's document
// thumbnails failed with storage/unauthorized and spun forever.
//
// The claim is granted from the server-only `staff/{E164phone}` allowlist. It
// is deliberately NOT derived from "has a providers doc" or "onboarded ==
// true": both are self-service (a provider creates its own doc), so keying
// the claim off them would let anyone who verifies any phone number in the
// FoodyzzHQ app read every customer's driver license. staff/* is deny-all to
// clients in firestore.rules; only the Firebase Console or the admin SDK can
// populate it.
//
// Called by the FoodyzzHQ client on every sign-in. Also REVOKES: an account
// removed from the allowlist (or flipped active:false) drops the claim on its
// next sign-in.
export const syncAdminClaim = onCall(async (request) => {
  const uid = request.auth?.uid;
  const phone = request.auth?.token.phone_number;
  if (!uid || !phone) {
    throw new HttpsError("unauthenticated", "Sign in required.");
  }

  const staff = await db.collection("staff").doc(phone).get();
  const shouldBeAdmin = staff.exists && staff.data()?.active !== false;

  // Read the claims off the auth RECORD, not off request.auth.token — the
  // caller's token can be stale (claims don't invalidate an issued token), and
  // comparing against the record keeps this a no-op on a repeat sign-in.
  const existing = (await getAuth().getUser(uid)).customClaims || {};
  const changed = (existing.admin === true) !== shouldBeAdmin;

  if (changed) {
    // Merge rather than replace: setCustomUserClaims overwrites the whole
    // object, so a bare {admin:true} would drop any other claim added later.
    const next: Record<string, unknown> = {...existing};
    if (shouldBeAdmin) next.admin = true;
    else delete next.admin;
    await getAuth().setCustomUserClaims(uid, next);
    console.log(`syncAdminClaim: ${phone} admin -> ${shouldBeAdmin}`);
  }

  // `changed` tells the client whether it must force-refresh its ID token.
  return {admin: shouldBeAdmin, changed};
});
