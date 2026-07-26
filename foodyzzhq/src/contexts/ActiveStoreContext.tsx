import React, { createContext, useContext } from 'react';

/**
 * Lets any screen switch the active store without a full logout. Switching
 * re-mounts the provider UI subtree so every screen re-reads the new active
 * store via getActiveProviderId().
 *
 * Takes the store's DOCUMENT ID, not the zip suffix it used to: a store id names
 * whoever created it, and a member operating someone else's store cannot rebuild
 * it from their own phone number.
 */
export type ActiveStoreContextValue = {
  switchStore: (providerId: string) => Promise<void>;
};

export const ActiveStoreContext = createContext<ActiveStoreContextValue>({
  switchStore: async () => {},
});

export const useActiveStore = () => useContext(ActiveStoreContext);
