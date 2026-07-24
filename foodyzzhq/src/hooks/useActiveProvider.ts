import { useEffect, useState } from 'react';
import { auth, db, getActiveProviderId } from '../services/firebase';

/**
 * Subscribes to the active store's provider document (`${phone}_${zip}`).
 *
 * Encapsulates the getActiveProviderId() → provider doc onSnapshot pattern that
 * was copy-pasted across Dispatch/Logistics/Deposits/Account/Promos, including
 * the cancelled-flag guard that prevents a listener leak when the component
 * unmounts (or the store switches, which remounts the navigator) while
 * getActiveProviderId() is still awaiting AsyncStorage.
 *
 * Behaviour matches the previous inline blocks: `profile` includes the doc id;
 * `loading` flips false once the first snapshot (or a terminal/no-store state)
 * arrives.
 */
export function useActiveProvider() {
  const user = auth().currentUser;
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.phoneNumber && !user?.email) { setLoading(false); return; }

    let cancelled = false;
    let unsub: (() => void) | undefined;

    (async () => {
      const providerId = await getActiveProviderId();
      if (cancelled) return;
      if (!providerId) { setLoading(false); return; }
      unsub = db.collection('providers').doc(providerId).onSnapshot(
        (snap) => {
          if (snap?.exists) setProfile({ id: snap.id, ...snap.data() });
          setLoading(false);
        },
        (error: any) => {
          // permission-denied fires transiently right after logout — expected.
          if (error?.code !== 'firestore/permission-denied') {
            console.error('useActiveProvider listener error:', error);
          }
          setLoading(false);
        },
      );
      if (cancelled) { unsub(); unsub = undefined; }
    })();

    return () => { cancelled = true; unsub?.(); };
  }, [user?.phoneNumber, user?.email]);

  return { profile, loading };
}
