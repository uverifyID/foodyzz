import { getFirestore } from "firebase-admin/firestore";

// Where a signup IP address sits. Shared with the Suds backend (same module, same
// apiConfigSecret/ipgeolocation key); customerVerification.ts is the caller here.
//
// The device GPS is what the location check is built on; this is the second,
// independent signal — a phone reporting a Manhattan delivery address while the
// connection exits in another country is worth seeing, and so is "this is a
// proxy", which a GPS fix cannot tell you.
//
// ⚠️ It is corroboration, never proof. IP geolocation resolves to the ISP's exit,
// which can be a town away or a different state on mobile networks, and a VPN
// moves it anywhere. So it never FAILS a check on its own: a non-US or proxy
// result only sends an otherwise-passing location check to a person
// (customerVerification.ts ipNeedsReview).
//
// Privacy: this sends ONE value to the lookup service — the IP address the signup
// came from — and stores what comes back. No name, phone or any other field goes
// with it. The call is made from the server, so a customer's address never leaves
// through an admin's browser.
//
// freeipapi's free tier needs no API key, allows 60 requests a minute (we make one
// per signup), supports IPv4 and IPv6 over HTTPS, and permits commercial use.

// freeipapi needs no account. ipgeolocation.io is used instead when a key is
// stored at apiConfigSecret/ipgeolocation.apiKey — its data is better and it adds
// VPN/threat detection on paid plans. Same stored shape either way, so the admin
// hub and this module's callers do not care which answered.
const FREEIPAPI = "https://free.freeipapi.com/api/v1/json";
const IPGEOLOCATION = "https://api.ipgeolocation.io/ipgeo";
const TIMEOUT_MS = 4000;
const KEY_TTL_MS = 60_000;

export interface IpLocation {
  city?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  network?: string;
  proxy?: boolean;
  /** Which service answered, so a stored record explains itself later. */
  source: "freeipapi" | "ipgeolocation";
  at: string;
}

const str = (v: unknown): string | undefined => {
  const s = String(v ?? "").trim();
  // The service returns the literal "-" for fields it has no answer for.
  return s && s !== "-" ? s : undefined;
};
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

let keyCache: { key: string | null; at: number } | null = null;

export function resetIpLocationKeyCache(): void {
  keyCache = null;
}

async function ipGeolocationKey(): Promise<string | null> {
  const now = Date.now();
  if (keyCache && now - keyCache.at < KEY_TTL_MS) return keyCache.key;
  const snap = await getFirestore().doc("apiConfigSecret/ipgeolocation").get().catch(() => null);
  const key = String(snap?.data()?.apiKey ?? "").trim() || null;
  keyCache = { key, at: now };
  return key;
}

/** A loopback, private or link-local address (ours or the client's LAN — never a public client). */
export function isPrivateIp(ip: string): boolean {
  const addr = String(ip ?? "").trim().replace(/^::ffff:/i, "");
  return /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::1$|f[cd]|fe80:)/i.test(addr);
}

/**
 * Looks up `ip`. Returns null for a private/loopback address, an unreachable
 * service, or a slow one — a signup must never fail because a third-party lookup
 * did.
 */
export async function lookupIpLocation(ip: string | null | undefined, now = new Date()): Promise<IpLocation | null> {
  const addr = String(ip ?? "").trim();
  // Local and private ranges say nothing, and the emulator / a proxied request
  // often reports one. Cheap to skip, and it keeps tests off the network.
  if (!addr || isPrivateIp(addr)) return null;

  try {
    const key = await ipGeolocationKey();
    const url = key
      ? `${IPGEOLOCATION}?apiKey=${encodeURIComponent(key)}&ip=${encodeURIComponent(addr)}`
      : `${FREEIPAPI}/${encodeURIComponent(addr)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const b: any = await res.json();
    const loc: IpLocation = key
      ? {
        city: str(b.city),
        region: str(b.state_prov),
        country: str(b.country_name),
        countryCode: str(b.country_code2),
        zip: str(b.zipcode),
        lat: num(Number(b.latitude)),
        lng: num(Number(b.longitude)),
        network: str(b.isp) ?? str(b.organization),
        proxy: typeof b.security?.is_proxy === "boolean" ? b.security.is_proxy : undefined,
        source: "ipgeolocation",
        at: now.toISOString(),
      }
      : {
        city: str(b.cityName),
        region: str(b.regionName),
        country: str(b.countryName),
        countryCode: str(b.countryCode),
        zip: str(b.zipCode),
        lat: num(b.latitude),
        lng: num(b.longitude),
        network: str(b.asnOrganization) ?? str(b.asn),
        proxy: typeof b.isProxy === "boolean" ? b.isProxy : undefined,
        source: "freeipapi",
        at: now.toISOString(),
      };
    // Nothing usable came back (an unknown or reserved address).
    if (!loc.city && !loc.region && !loc.country && loc.lat === undefined) return null;
    // Firestore rejects undefined; drop the keys the service had no answer for.
    return Object.fromEntries(Object.entries(loc).filter(([, v]) => v !== undefined)) as IpLocation;
  } catch {
    return null;
  }
}
