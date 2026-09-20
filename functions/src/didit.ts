// ── Didit identity verification: config, HTTP layer, webhook signature ──────
// Ported from the Suds backend (suds/functions/src/didit.ts) so the two apps
// verify the same way; kept as its own copy so Foodyzz can be split off later.
//
// Everything that talks to https://verification.didit.me lives in `diditApi`, one
// small object, so tests replace it with jest.spyOn and never reach the network.
// The rest of this file is pure (signature canonicalisation, decision summary).
//
// Secrets: apiConfigSecret/didit { apiKey, workflowId, webhookSecret, organizationId? },
// denied to every client by firestore.rules. Loaded like SMTP: cached 60s,
// failed-precondition when missing.

import {HttpsError} from "firebase-functions/v2/https";
import {getFirestore} from "firebase-admin/firestore";
import * as logger from "firebase-functions/logger";
import * as crypto from "crypto";

// Lazy: this module is evaluated before index.ts calls initializeApp().
const db = () => getFirestore();

export const DIDIT_BASE = "https://verification.didit.me";

export interface DiditConfig {
  apiKey: string;
  workflowId: string;
  webhookSecret: string;
  organizationId?: string;
}

/** All a client is told when the Didit configuration is missing or invalid. */
export const DIDIT_UNAVAILABLE = "Identity verification is temporarily unavailable. Please try again later.";

const DIDIT_TTL_MS = 60_000;
let diditCache: { data: DiditConfig; at: number } | null = null;

export function resetDiditConfigCache(): void {
  diditCache = null;
}

export async function loadDiditConfig(): Promise<DiditConfig> {
  const now = Date.now();
  if (diditCache && now - diditCache.at < DIDIT_TTL_MS) return diditCache.data;
  const snap = await db().doc("apiConfigSecret/didit").get();
  const cfg: any = snap.exists ? snap.data() : null;
  // What went wrong is logged for us; a customer only ever sees DIDIT_UNAVAILABLE —
  // never the secret doc's path or its values.
  if (!cfg?.apiKey || !cfg?.workflowId || !cfg?.webhookSecret) {
    logger.error("Didit: identity verification is not configured (apiConfigSecret/didit needs apiKey, workflowId, webhookSecret).");
    throw new HttpsError("failed-precondition", DIDIT_UNAVAILABLE);
  }
  // The workflow id is a UUID. The token in a Didit share link
  // (verify.didit.me/u/<token>) looks like an id and is the easy thing to paste,
  // but Didit rejects it at session creation — in front of a customer mid-checkout.
  // Fail here instead, naming the value in the log. `node scripts/didit-workflows.js`
  // prints the real ids.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(cfg.workflowId))) {
    logger.error(
      `Didit: apiConfigSecret/didit.workflowId is "${cfg.workflowId}", which is not a workflow UUID. ` +
      "Run functions/scripts/didit-workflows.js and store the workflow_id it prints.",
    );
    throw new HttpsError("failed-precondition", DIDIT_UNAVAILABLE);
  }
  diditCache = {data: cfg as DiditConfig, at: now};
  return diditCache.data;
}

// Didit's final session states. Anything else may still change, so the status
// callable re-reads the decision while a session sits in one of the others.
export const FINAL_DIDIT_STATUSES = new Set(["Approved", "Declined", "Abandoned", "Expired", "Kyc Expired"]);

async function diditJson(res: Response, what: string): Promise<any> {
  if (!res.ok) {
    // The body of a Didit error is a short `detail` string; never echo the request.
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Didit ${what} failed (HTTP ${res.status}): ${detail}`);
  }
  return res.json();
}

/**
 * The whole Didit HTTP surface. Methods are looked up on this object at call time
 * (never destructured), which is what lets a test spy on them.
 */
export const diditApi = {
  /** POST /v3/session/ → { session_id, session_token, url, status, ... } */
  async createSession(cfg: DiditConfig, vendorData: string): Promise<any> {
    const res = await fetch(`${DIDIT_BASE}/v3/session/`, {
      method: "POST",
      headers: {"x-api-key": cfg.apiKey, "Content-Type": "application/json"},
      body: JSON.stringify({workflow_id: cfg.workflowId, vendor_data: vendorData}),
    });
    return diditJson(res, "create session");
  },

  /** GET /v3/session/{id}/decision/ → the V3 decision object (plural module arrays). */
  async getDecision(cfg: DiditConfig, sessionId: string): Promise<any> {
    const res = await fetch(`${DIDIT_BASE}/v3/session/${encodeURIComponent(sessionId)}/decision/`, {
      headers: {"x-api-key": cfg.apiKey},
    });
    return diditJson(res, "get decision");
  },

  /** Downloads a presigned media URL from a decision (e.g. liveness reference_image). */
  async downloadImage(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Didit media download failed (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  },
};

// ── Webhook signature (X-Signature-V2) ─────────────────────────────────────
// Didit signs a canonical re-serialisation rather than the raw bytes, so the check
// survives Express having already parsed the body: whole-number floats shortened,
// keys sorted recursively, JSON.stringify with unescaped Unicode (the JS default).

export function shortenFloats(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(shortenFloats);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, shortenFloats(x)]),
    );
  }
  if (typeof v === "number" && !Number.isInteger(v) && v % 1 === 0) return Math.trunc(v);
  return v;
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = sortKeys((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
  }
  return v;
}

export function diditSignature(parsed: unknown, secret: string): string {
  const canonical = JSON.stringify(sortKeys(shortenFloats(parsed)));
  return crypto.createHmac("sha256", secret).update(canonical, "utf8").digest("hex");
}

export const WEBHOOK_MAX_SKEW_SEC = 300;

/** "ok" when the delivery is fresh and signed with `secret`; otherwise why not. */
export function verifyDiditWebhook(
  parsed: unknown, signature: string, timestamp: unknown, secret: string, nowMs = Date.now(),
): "ok" | "stale" | "bad_signature" {
  const ts = Number(timestamp);
  if (!ts || !Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > WEBHOOK_MAX_SKEW_SEC) return "stale";
  const expected = diditSignature(parsed, secret);
  const sig = String(signature ?? "");
  if (sig.length !== expected.length) return "bad_signature";
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)) ? "ok" : "bad_signature";
}

// ── Decision summary ───────────────────────────────────────────────────────
// What we keep from a decision: enough for the admin review and the address
// match, never the document number or the MRZ. V3 decisions carry one entry per
// workflow node in plural arrays; the KYC workflow runs each module once, so the
// first entry is the one.

const first = (v: unknown): any => (Array.isArray(v) && v.length ? v[0] : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Drops undefined values — Firestore rejects them. */
export function compact<T extends Record<string, unknown>>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export interface DiditSummary {
  firstName?: string; middleName?: string; lastName?: string;
  dateOfBirth?: string;
  documentType?: string; documentExpiry?: string; issuingState?: string;
  idAddress?: string;
  idZip?: string;
  livenessScore?: number; faceMatchScore?: number;
  ipAddress?: string; ipCountry?: string; ipState?: string; ipCity?: string;
  ipIsp?: string; ipDataCenter?: boolean; vpn?: boolean; proxy?: boolean;
  warnings?: string[];
}

/** The 5-digit ZIP on a US address string, from the right (a street number can look like one). */
export function zipOf(address: unknown): string | undefined {
  const all = String(address ?? "").match(/\b\d{5}(?:-\d{4})?\b/g);
  return all?.length ? all[all.length - 1].slice(0, 5) : undefined;
}

export function summarizeDecision(decision: any): DiditSummary {
  const id = first(decision?.id_verifications) ?? {};
  const live = first(decision?.liveness_checks) ?? {};
  const face = first(decision?.face_matches) ?? {};
  const ip = first(decision?.ip_analyses) ?? {};

  const warnings: string[] = [];
  for (const mod of [id, live, face, ip]) {
    for (const w of (Array.isArray(mod?.warnings) ? mod.warnings : [])) {
      const label = typeof w === "string" ? w : (w?.risk || w?.short_description);
      if (label && !warnings.includes(String(label))) warnings.push(String(label));
    }
  }

  // `vpn` is a boolean in Didit's reference appendix but an object in the
  // data-model docs (with `is_vpn_or_tor` alongside); accept either.
  const vpn = bool(ip.vpn) ?? bool(ip.is_vpn_or_tor) ??
    (ip.vpn && typeof ip.vpn === "object" ? bool(ip.vpn.is_vpn) : undefined);

  const idAddress = str(id.formatted_address) ?? str(id.address);
  const parsed = id.parsed_address && typeof id.parsed_address === "object" ? id.parsed_address : {};
  const idZip = str(parsed.postal_code)?.slice(0, 5) ?? str(parsed.zip_code)?.slice(0, 5) ?? zipOf(idAddress);

  return compact({
    firstName: str(id.first_name),
    middleName: str(id.middle_name),
    lastName: str(id.last_name),
    dateOfBirth: str(id.date_of_birth),
    documentType: str(id.document_type),
    documentExpiry: str(id.expiration_date),
    issuingState: str(id.issuing_state),
    idAddress,
    idZip: idZip && /^\d{5}$/.test(idZip) ? idZip : undefined,
    livenessScore: num(live.score),
    faceMatchScore: num(face.score),
    ipAddress: str(ip.ip_address),
    ipCountry: str(ip.country) ?? str(ip.ip_country),
    // Where Didit saw the session come from. Coarse by nature, and on the native
    // SDK it can be Didit's own infrastructure — context for a reviewer only. The
    // location check is the device GPS against the delivery address.
    ipState: str(ip.ip_state) ?? str(ip.state),
    ipCity: str(ip.ip_city) ?? str(ip.city),
    ipIsp: str(ip.isp) ?? str(ip.organization),
    ipDataCenter: bool(ip.is_data_center),
    vpn,
    proxy: bool(ip.proxy),
    warnings: warnings.length ? warnings : undefined,
  }) as DiditSummary;
}

/** The liveness selfie only — never the ID document's portrait crop. */
export function livenessImageUrlOf(decision: any): string | undefined {
  return str(first(decision?.liveness_checks)?.reference_image);
}

/**
 * The face image kept PRIVATELY as the reviewer's reference: the liveness selfie,
 * falling back to the ID document's portrait. Never published.
 */
export function portraitUrlOf(decision: any): string | undefined {
  return str(first(decision?.liveness_checks)?.reference_image) ??
    str(first(decision?.id_verifications)?.portrait_image);
}
