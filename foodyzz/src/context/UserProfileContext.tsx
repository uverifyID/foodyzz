import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../services/firebase';
import { logHandledError } from '../services/errors';

// Single source of truth for the signed-in customer's `users/{phone}` profile doc.
// Previously every tab screen (Explore, Account, Chat, the Wizard, the tab-bar
// unread badge) opened its OWN onSnapshot on the SAME doc — N identical live
// listeners for one document. This provider subscribes exactly once (keyed on the
// authenticated phone) and fans the result out via useUserProfile().

interface UserProfileContextValue {
  profile: any | null;
  // True until the first snapshot (or an error) resolves — mirrors the per-screen
  // `loading` flags the old listeners used to gate their initial spinner.
  loading: boolean;
}

const UserProfileContext = createContext<UserProfileContextValue>({ profile: null, loading: true });

export function UserProfileProvider({
  phone,
  children,
}: {
  phone: string | null | undefined;
  children: React.ReactNode;
}) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!phone) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = db.collection('users').doc(phone).onSnapshot(
      (snap) => {
        setProfile(snap && snap.exists ? snap.data() : null);
        setLoading(false);
      },
      (err) => {
        logHandledError('profile:listener', err);
        setLoading(false);
      },
    );
    return unsub;
  }, [phone]);

  return (
    <UserProfileContext.Provider value={{ profile, loading }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile(): UserProfileContextValue {
  return useContext(UserProfileContext);
}
