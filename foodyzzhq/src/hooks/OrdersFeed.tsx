import React, { createContext, useContext } from 'react';
import { useProviderOrders } from './useProviderOrders';
import { FEED_LIMIT } from '../utils/orderFeed';

/**
 * The one order listener the app runs, shared by Dispatch and Operations.
 *
 * Both screens read the same unfiltered window now (they divide it by status in
 * `utils/orderFeed`, not in the query), so giving each its own `useProviderOrders`
 * would open two identical listeners: every order read twice on the initial
 * snapshot, and every subsequent order write delivered twice. One subscription at
 * the navigator instead, mounted once for the life of the tabs.
 *
 * Sharing the optimistic overlay is the other half of the point. An order accepted
 * on Dispatch crosses into Operations as it advances; with separate hook instances
 * the patch lived in whichever screen applied it, so the card could arrive in the
 * other tab still showing its pre-tap status until the mirror caught up.
 */
type OrdersFeed = ReturnType<typeof useProviderOrders>;

const Ctx = createContext<OrdersFeed | null>(null);

export function OrdersFeedProvider({ children }: { children: React.ReactNode }) {
  const feed = useProviderOrders({ limitTo: FEED_LIMIT });
  return <Ctx.Provider value={feed}>{children}</Ctx.Provider>;
}

export function useOrdersFeed(): OrdersFeed {
  const feed = useContext(Ctx);
  if (!feed) throw new Error('useOrdersFeed must be used inside <OrdersFeedProvider>');
  return feed;
}
