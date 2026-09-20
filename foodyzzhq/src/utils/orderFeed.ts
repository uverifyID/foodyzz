import { OrderStatus } from '../types';

// One unfiltered feed of `providerOrders` backs both order screens (see
// useProviderOrders), and this is the line that divides it. The split is made
// here, once, so the two screens cannot drift into overlapping — or worse,
// leaving a gap that hides an order from the whole app, which is exactly what
// the old pair of hand-maintained status allow-lists did to `cancelled`.
//
// Operations (the Logistics tab) owns the order from the moment its documents
// are verified and the bike can go out — that is where staff pick the physical
// bike number — through to completion, plus the Cancelled lane. Dispatch keeps
// the front of the funnel: pending and awaiting-documents.
const OPERATIONS_STATUSES: ReadonlySet<string> = new Set([
  OrderStatus.READY_FOR_DELIVERY,
  OrderStatus.EN_ROUTE_DELIVERY,
  OrderStatus.AT_DELIVERY,
  OrderStatus.DELIVERED,
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
]);

/**
 * Orders Dispatch shows: pending (`requested`), accepted-and-awaiting-documents
 * (`confirmed`), and — deliberately — any status this build does not recognise.
 * Defining Dispatch as the COMPLEMENT of Operations rather than as its own
 * allow-list is what guarantees every order lands on exactly one of the two
 * screens, including a status written by a newer build or edited by hand.
 */
export function isDispatchOrder(order: any): boolean {
  if (!OPERATIONS_STATUSES.has(String(order?.status))) return true;
  // One exception, to keep the two screens genuinely exhaustive. Operations files
  // an order by LANE, not by status, and categoryOf() gives a delivered BUY no lane
  // at all — a buy has no return leg, so markRentalDelivered normally takes it
  // straight to COMPLETED. A legacy order left sitting in DELIVERED would therefore
  // be in Operations' window but in none of its lanes, and excluded from Dispatch by
  // its status: visible nowhere. Dispatch takes it.
  return order?.status === OrderStatus.DELIVERED && order?.rentalType === 'buy';
}

// How many of the most recent orders either screen holds. The window now spans
// every status, so it carries the delivered/completed/cancelled tail as well as
// live work — hence larger than the 100 each screen used when it queried only its
// own statuses. Orders beyond it stay reachable by number or QR through the
// Logistics remote-id lookup.
export const FEED_LIMIT = 250;
