import { useEffect, useMemo, useState, useCallback } from 'react';
import { db, isTransient, resetFirestoreConnection } from '../services/firebase';

export type ProviderOrdersOpts = {
  /** caps results with `.limit()`. */
  limitTo?: number;
};

type Patch = { data: Record<string, any>; at: number };

// How long an optimistic overlay survives before it self-expires. Covers the worst
// case where the provider-mirror trigger is slow to catch up; after this the UI
// reverts to the authoritative mirror so a patch can never get stuck showing a wrong
// state.
const PATCH_TTL_MS = 15000;
// Backoff before re-subscribing a dropped listener: base delay, hard cap, and the
// attempt at which we force a stream reset to unwedge a persistently-unavailable client.
const RESUBSCRIBE_MS = 3000;
const MAX_RESUBSCRIBE_MS = 30000;
const RESET_AT_ATTEMPT = 5;

// The order's linear progression, used to retire an optimistic `status` overlay once
// the authoritative mirror has advanced TO or PAST it. This is the real lifecycle:
// a rider requests, staff accept, documents clear, the bike goes out, it is handed
// over, and eventually it comes back.
//
// `cancelled` is deliberately NOT on this line. A server jump to it means the
// optimistic linear advance no longer applies, so the overlay is retired rather than
// pinned to a status the order will never reach.
//
// Every entry must be a value that actually lands on `order.status`. The previous
// version listed en_route_pickup, at_pickup and rental_active, which only ever
// appear on `providerCurrentStatus` — a different field — and omitted
// ready_for_delivery, which is a real and heavily-used one. Anything missing here
// ranks -1, and isPatchSatisfied treats a doc at -1 as "already caught up", so an
// absent status silently retires every overlay while the order sits on it.
const STATUS_ORDER = [
  'requested', 'confirmed', 'ready_for_delivery',
  'en_route_delivery', 'at_delivery', 'delivered', 'completed',
];
const statusRank = (s: any): number => STATUS_ORDER.indexOf(s); // -1 = off-axis/unknown

// Server regenerates these; a client-written ISO string never matches the server value,
// so they must not gate whether an overlay has been satisfied.
const TIMESTAMP_KEYS = new Set(['updatedAt', 'completedAt']);

// Whether the authoritative doc has caught up to (or moved past) an optimistic patch,
// so the overlay can be retired. Status uses an ordinal "at or beyond" compare; other
// keys use exact equality; timestamp keys are ignored.
const isPatchSatisfied = (doc: any, data: Record<string, any>): boolean =>
  Object.keys(data).every((k) => {
    if (TIMESTAMP_KEYS.has(k)) return true;
    if (k === 'status') {
      const docRank = statusRank(doc[k]);
      const patchRank = statusRank(data[k]);
      if (docRank === -1) return true;                 // server went off the linear axis
      if (patchRank === -1) return doc[k] === data[k]; // odd patch target → exact match
      return docRank >= patchRank;                     // mirror caught up or advanced past
    }
    return doc[k] === data[k];
  });

/**
 * Live orders for FoodyzzHQ: the most recent `limitTo`, newest first.
 *
 * NO STATUS FILTER, deliberately. The two screens used to query disjoint status
 * allow-lists, which meant any status in neither list was invisible in the whole
 * app — `cancelled` was, and three of Dispatch's five listed statuses
 * (en_route_pickup, at_pickup, pending_customer_confirmation) had never been
 * written to `status` at all, so the list was both leaky and stale. The goal is
 * that every order placed in the Foodyzz app is visible here, so the split is now
 * made in the screens, over one shared feed: Operations claims its five delivery
 * statuses plus cancelled, and Dispatch shows everything else — including a status
 * this build has never heard of. Nothing can fall between them.
 *
 * It also means the query is a bare orderBy(createdAt), which Firestore's automatic
 * single-field index serves — no composite index to deploy before a build ships.
 *
 * PLATFORM-WIDE, not scoped to the active store — the same call the Chat Center
 * already makes. FoodyzzHQ is the admin app: everyone holding it is staff, and
 * Foodyzz owns the whole fleet, so "orders my currently-selected store was sent"
 * is not a boundary anyone wants. Scoping it meant an admin switched into store B
 * got the push for an order placed to store A (the push goes to every device token
 * on the store doc) and then found an empty feed, with no way to tell that from a
 * quiet day. firestore.rules already agrees: isHqStaff may read every mirror doc
 * and drive the workflow fields on every order, with no membership check.
 *
 * Providers read the provider-safe MIRROR (`providerOrders`), which a Cloud Function
 * rebuilds after each write to `orders`. That mirror hop adds latency, so the hook
 * exposes `applyOptimistic`/`clearOptimistic`: screens patch an order locally the
 * instant they act (claim / status change) and the card advances immediately, then
 * the patch auto-clears once the mirror catches up (or after PATCH_TTL_MS, or on
 * explicit rollback). The listener also re-subscribes on transient stream drops so a
 * wedged snapshot no longer forces an app restart.
 */
export function useProviderOrders(opts: ProviderOrdersOpts = {}) {
  const { limitTo } = opts;
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // Set when the listener died on a TERMINAL error (permission-denied on a stale
  // hqStaff claim, failed-precondition on a missing index). Without it every such
  // failure rendered as the ordinary "nothing here" empty state, so a broken feed
  // and a quiet day looked identical on the device.
  const [error, setError] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, Patch>>({});

  const applyOptimistic = useCallback((orderId: string, data: Record<string, any>) => {
    setPatches(prev => ({
      ...prev,
      [orderId]: { data: { ...(prev[orderId]?.data || {}), ...data }, at: Date.now() },
    }));
  }, []);

  const clearOptimistic = useCallback((orderId: string) => {
    setPatches(prev => {
      if (!prev[orderId]) return prev;
      const next = { ...prev };
      delete next[orderId];
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: () => void = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0; // consecutive transient failures, for backoff; reset on a good snapshot

    const subscribe = () => {
      // Read the provider-safe mirror (charge/authorization fields stripped server-side),
      // never the raw `orders` collection — providers must not see customer charges.
      let query: any = db.collection('providerOrders').orderBy('createdAt', 'desc');
      if (limitTo) query = query.limit(limitTo);

      unsub = query.onSnapshot(
        (snap: any) => {
          // Same reason as the error path: a snapshot from the listener this effect
          // is replacing must not overwrite the new one's results.
          if (cancelled) return;
          attempt = 0; // a healthy snapshot resets the resubscribe backoff
          const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          setOrders(docs);
          setLoading(false);
          setError(null);
          // Retire optimistic overlays the authoritative mirror now satisfies (status
          // caught up or advanced past), that have expired, or whose order left this
          // query — so overlays self-heal.
          setPatches(prev => {
            const ids = Object.keys(prev);
            if (!ids.length) return prev;
            const now = Date.now();
            const next = { ...prev };
            let changed = false;
            for (const id of ids) {
              const doc = docs.find((d: any) => d.id === id);
              const satisfied = doc && isPatchSatisfied(doc, prev[id].data);
              const expired = now - prev[id].at > PATCH_TTL_MS;
              if (!doc || satisfied || expired) { delete next[id]; changed = true; }
            }
            return changed ? next : prev;
          });
        },
        // Named `err` rather than `error`: the hook's own error STATE is in scope
        // here, and shadowing it makes the setError calls below hard to read.
        (err: any) => {
          // A torn-down listener must not write state. unsub() does not retract a
          // callback already in flight, so without this a dying listener's terminal
          // error could land after the replacement listener's first good snapshot
          // and pin an error banner describing a subscription that no longer exists.
          if (cancelled) return;
          setLoading(false);
          // Only known-transient failures (dropped/wedged streams: unavailable,
          // deadline-exceeded, cancelled, internal, network) are worth re-subscribing.
          // Terminal errors — permission-denied (signed out), failed-precondition
          // (missing index), invalid-argument, resource-exhausted (quota) — would just
          // reconnect a doomed listener forever, so we surface them and stop.
          if (!isTransient(err)) {
            console.error('useProviderOrders listener error (terminal):', err);
            // Say which of the two it is: "sign out and back in" fixes a stale claim,
            // and nothing the person on the device can do fixes a missing index.
            setError(String(err?.code || '').includes('permission-denied')
              ? 'No access to the order feed — sign out and back in to refresh your staff permissions.'
              : `Order feed unavailable (${err?.code || 'unknown error'}).`);
            return;
          }
          attempt += 1;
          // A persistently-unavailable client is usually a wedged gRPC stream; toggling
          // the network once unsticks it without wiping the cache.
          if (attempt === RESET_AT_ATTEMPT) resetFirestoreConnection().catch(() => {});
          const delay = Math.min(RESUBSCRIBE_MS * 2 ** (attempt - 1), MAX_RESUBSCRIBE_MS);
          clearTimeout(retry);
          retry = setTimeout(() => {
            if (cancelled) return;
            try { unsub(); } catch { /* already torn down */ }
            subscribe();
          }, delay);
        },
      );
    };

    subscribe();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      try { unsub(); } catch { /* already torn down */ }
    };
  }, [limitTo]);

  // Orders with any live optimistic overlay applied (skipping ones the snapshot has
  // already caught up to, which are also pruned above).
  const merged = useMemo(() => {
    if (!Object.keys(patches).length) return orders;
    return orders.map(o => {
      const p = patches[o.id];
      if (!p) return o;
      return isPatchSatisfied(o, p.data) ? o : { ...o, ...p.data };
    });
  }, [orders, patches]);

  return { orders: merged, loading, error, applyOptimistic, clearOptimistic };
}
