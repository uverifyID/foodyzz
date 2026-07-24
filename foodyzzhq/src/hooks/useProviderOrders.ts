import { useEffect, useMemo, useState, useCallback } from 'react';
import { db, isTransient, resetFirestoreConnection } from '../services/firebase';

export type ProviderOrdersOpts = {
  /** status `in` filter (omit for no status constraint). */
  statuses?: string[];
  /** ISO string; adds `createdAt >= createdAfter` (bounded window). */
  createdAfter?: string;
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

// Linear pickup→delivery progression, used to retire an optimistic `status` overlay
// once the authoritative mirror has advanced TO or PAST it. Off-axis statuses
// (pending_customer_confirmation, cancelled) are deliberately NOT on this line: a
// server jump to one of them means the optimistic linear advance no longer applies,
// so the overlay is retired rather than pinned. Do not reuse the enum declaration
// order — it lists pending_customer_confirmation last even though it occurs early.
const STATUS_ORDER = [
  'requested', 'confirmed', 'en_route_pickup', 'at_pickup', 'rental_active',
  'completed', 'en_route_delivery', 'at_delivery', 'delivered',
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
 * Live orders for the active provider. Composes the three distinct queries the
 * FoodyzzHQ screens use, with identical semantics + indexes:
 *  - Dispatch:  { statuses:[…] }
 *  - Logistics: { statuses:[…], limitTo:100 }
 *  - Deposits:  { createdAfter: windowStartISO }
 * Every order is directed at exactly one store — there is no broadcast feed.
 * Always ordered by createdAt desc. No-op until `providerId` is known.
 *
 * Providers read the provider-safe MIRROR (`providerOrders`), which a Cloud Function
 * rebuilds after each write to `orders`. That mirror hop adds latency, so the hook
 * exposes `applyOptimistic`/`clearOptimistic`: screens patch an order locally the
 * instant they act (claim / status change) and the card advances immediately, then
 * the patch auto-clears once the mirror catches up (or after PATCH_TTL_MS, or on
 * explicit rollback). The listener also re-subscribes on transient stream drops so a
 * wedged snapshot no longer forces an app restart.
 */
export function useProviderOrders(providerId: string | undefined, opts: ProviderOrdersOpts = {}) {
  const { statuses, createdAfter, limitTo } = opts;
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [patches, setPatches] = useState<Record<string, Patch>>({});

  // Stable primitive dep for the statuses array.
  const statusesKey = statuses ? statuses.join(',') : '';

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
    if (!providerId) return;

    let cancelled = false;
    let unsub: () => void = () => {};
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0; // consecutive transient failures, for backoff; reset on a good snapshot

    const subscribe = () => {
      // Read the provider-safe mirror (charge/authorization fields stripped server-side),
      // never the raw `orders` collection — providers must not see customer charges.
      let query: any = db.collection('providerOrders').where('providerId', '==', providerId);
      if (statuses && statuses.length) query = query.where('status', 'in', statuses);
      if (createdAfter) query = query.where('createdAt', '>=', createdAfter);
      query = query.orderBy('createdAt', 'desc');
      if (limitTo) query = query.limit(limitTo);

      unsub = query.onSnapshot(
        (snap: any) => {
          attempt = 0; // a healthy snapshot resets the resubscribe backoff
          const docs = snap.docs.map((d: any) => ({ id: d.id, ...d.data() }));
          setOrders(docs);
          setLoading(false);
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
        (error: any) => {
          setLoading(false);
          // Only known-transient failures (dropped/wedged streams: unavailable,
          // deadline-exceeded, cancelled, internal, network) are worth re-subscribing.
          // Terminal errors — permission-denied (signed out), failed-precondition
          // (missing index), invalid-argument, resource-exhausted (quota) — would just
          // reconnect a doomed listener forever, so we surface them and stop.
          if (!isTransient(error)) {
            console.error('useProviderOrders listener error (terminal):', error);
            return;
          }
          if (cancelled) return;
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
  }, [providerId, statusesKey, createdAfter, limitTo]);

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

  return { orders: merged, loading, applyOptimistic, clearOptimistic };
}
