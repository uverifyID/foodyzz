import { useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { subscribeToLogisticsConfig, DEFAULT_LOGISTICS } from '../services/logistics';
import type { LogisticsConfig } from '../types';

export interface ModelInventory {
  model: number;
  name: string;
  // Live counts of bikes currently `available` for this model, split by condition.
  new: number;
  used: number;
}

/**
 * Live fleet availability, per model, derived from the `bikes` collection — the same
 * source the customer app quotes from and the admin fleet rolls up, so the numbers
 * always agree. A bike counts here only while its status is `available`; reserving,
 * renting or selling it drops it out, and a return puts it back.
 */
export function useBikeInventory() {
  const [config, setConfig] = useState<LogisticsConfig>(DEFAULT_LOGISTICS);
  const [counts, setCounts] = useState<Record<number, { new: number; used: number }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => subscribeToLogisticsConfig(setConfig), []);

  useEffect(() => {
    // Minimal safe bound so we don't stream the entire fleet into memory.
    // Long-term fix: maintain a per-model availability aggregate doc and read
    // that instead of scanning every bike document.
    const unsub = db.collection('bikes').limit(500).onSnapshot(
      (snap: any) => {
        const c: Record<number, { new: number; used: number }> = {};
        snap.docs.forEach((d: any) => {
          const b = d.data();
          if (b.status !== 'available') return;
          if (!c[b.model]) c[b.model] = { new: 0, used: 0 };
          if (b.condition === 'new') c[b.model].new += 1;
          else if (b.condition === 'used') c[b.model].used += 1;
        });
        setCounts(c);
        setLoading(false);
      },
      (e: any) => { console.warn('useBikeInventory: bikes listener failed', e); setLoading(false); },
    );
    return () => unsub();
  }, []);

  const models: ModelInventory[] = (config.bikeModels || []).map((m) => ({
    model: m.model,
    name: m.name,
    new: counts[m.model]?.new ?? 0,
    used: counts[m.model]?.used ?? 0,
  }));

  return { models, loading };
}
