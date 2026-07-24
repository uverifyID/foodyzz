import React, { createContext, useContext } from 'react';

/**
 * Lets any screen switch the active store (`active_provider_zip`) without a full
 * logout. Switching re-mounts the provider UI subtree so every screen re-reads
 * the new active store via getActiveProviderId().
 */
export type ActiveStoreContextValue = {
  switchStore: (zip: string) => Promise<void>;
};

export const ActiveStoreContext = createContext<ActiveStoreContextValue>({
  switchStore: async () => {},
});

export const useActiveStore = () => useContext(ActiveStoreContext);
