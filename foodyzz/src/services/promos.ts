// Promo codes — lookup, eligibility and discount math for the checkout wizard.
//
// A promo is a `promos/{providerId}_{promoId}` document authored in FoodyzzHQ. Its
// `offerType` binds the code to ONE kind of transaction (rent · rentToBuy · buy), so a
// rental coupon can never be spent on a purchase and vice versa.
//
// Everything here is a MIRROR of the authority in functions/src/index.ts
// (resolveCoupon / computePricing). The client validates so the customer sees the
// discounted total before they pay; the server re-validates and re-prices the same
// way before it authorizes the card. If the two ever disagree, checkout fails loudly
// rather than charging an amount the confirm step didn't show.
import { db } from './firebase';
import type { PromoCampaign, RentalType } from '../types';

// Codes are generated uppercase in FoodyzzHQ and pasted by hand, so normalize before
// both the lookup and the comparison.
export const normalizeCouponCode = (raw: string): string => raw.trim().toUpperCase();

// Promos store plain YYYY-MM-DD days, not timestamps, so expiry compares as a string.
const todayDay = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const RENTAL_TYPE_LABEL: Record<RentalType, string> = {
  rent: 'Rent',
  rentToBuy: 'Rent to Buy',
  buy: 'Buy',
};

/**
 * Find the active promo behind a code. Offer codes are unique enough in practice but
 * are not a document id, so this scans the small set of matches and takes the first
 * live one rather than assuming a single hit.
 */
export const lookupPromoByCode = async (code: string): Promise<PromoCampaign | null> => {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;
  const snap = await db
    .collection('promos')
    .where('offerCode', '==', normalized)
    // Bound the read — a handful of matches at most, and only one can be live.
    .limit(10)
    .get();
  const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as PromoCampaign[];
  return rows.find((p) => p.isActive !== false) ?? rows[0] ?? null;
};

export type PromoRejection =
  | 'not_found'
  | 'inactive'
  | 'expired'
  | 'already_used'
  | 'type_mismatch'
  | 'no_discount';

export interface PromoCheck {
  ok: boolean;
  reason?: PromoRejection;
  message?: string;
}

/**
 * Is this promo spendable on the order being built? The offerType check is the one
 * that matters most: a code is minted for exactly one transaction type and must not
 * apply to the other two.
 */
export const checkPromoForOrder = (
  promo: PromoCampaign | null,
  rentalType: RentalType | null,
  // The customer's own redemption list, off their user doc. Read from the profile the
  // app already streams — never from a roster published on the promo itself.
  redeemedPromoIds: string[] | undefined,
): PromoCheck => {
  if (!promo) return { ok: false, reason: 'not_found', message: "That promo code isn't valid." };
  if (promo.isActive === false) {
    return { ok: false, reason: 'inactive', message: 'That promo is no longer running.' };
  }

  const today = todayDay();
  // Two independent dates: the campaign's own run window, and how long a code stays
  // redeemable. Whichever lapses first ends the offer.
  const expiry = [promo.offerExpDate, promo.expirationDate].filter(Boolean) as string[];
  if (expiry.some((d) => d < today)) {
    return { ok: false, reason: 'expired', message: 'That promo code has expired.' };
  }

  // One redemption per customer. Advisory only — the backend's claim transaction is
  // what actually enforces it; this just saves a round trip to hear "no".
  if (redeemedPromoIds?.includes(promo.id)) {
    return { ok: false, reason: 'already_used', message: "You've already used that promo code." };
  }

  // The type gate. A promo with no offerType predates the field and is treated as
  // rent-only rather than as a wildcard — never widen an offer we can't read.
  const offerType = (promo.offerType ?? 'rent') as RentalType;
  if (!rentalType || offerType !== rentalType) {
    return {
      ok: false,
      reason: 'type_mismatch',
      message: `That code only works on ${RENTAL_TYPE_LABEL[offerType] ?? offerType} orders.`,
    };
  }

  if (!(Number(promo.discountValue) > 0)) {
    return { ok: false, reason: 'no_discount', message: "That promo code doesn't carry a discount." };
  }

  return { ok: true };
};

/**
 * What the promo takes off the rental subtotal. Never more than the subtotal itself —
 * a coupon zeroes the rental out, it never becomes a credit.
 */
export const promoDiscountFor = (promo: PromoCampaign | null, subtotal: number): number => {
  if (!promo || !(subtotal > 0)) return 0;
  const value = Number(promo.discountValue) || 0;
  if (value <= 0) return 0;
  const raw = promo.discountType === 'percentage' ? (subtotal * value) / 100 : value;
  return Math.round(Math.min(Math.max(raw, 0), subtotal) * 100) / 100;
};

// How the discount reads on the confirm step, e.g. "20% OFF" / "$15 OFF".
export const promoDiscountLabel = (promo: PromoCampaign): string =>
  promo.discountType === 'percentage'
    ? `${promo.discountValue}% off`
    : `$${Number(promo.discountValue ?? 0).toFixed(2)} off`;
