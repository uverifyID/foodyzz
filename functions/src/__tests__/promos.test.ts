import {
  callable, fns, phoneAuth, seedConfig, seedLogistics, seedProvider,
  clearFirestore, getDoc, db, triggerCreated,
} from './helpers';

const CUSTOMER = '+14025550000';
const CUSTOMER_DIGITS = '14025550000';
const PROVIDER = '14025551111_11743';
const PROMO_ID = `${PROVIDER}_SAVE1`;
const CLAIM_ID = `${PROMO_ID}__${CUSTOMER_DIGITS}`;

const dayFromNow = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

async function seedPromo(data: any = {}) {
  const doc: any = {
    providerId: PROVIDER,
    title: 'Spring Rental Deal',
    offerCode: 'SAVE20',
    offerType: 'rent',
    discountType: 'percentage',
    discountValue: 20,
    isActive: true,
    expirationDate: dayFromNow(30),
    offerExpDate: dayFromNow(30),
    ...data,
  };
  // Firestore rejects explicit undefined — an `undefined` override means "field absent".
  for (const k of Object.keys(doc)) if (doc[k] === undefined) delete doc[k];
  await db.doc(`promos/${PROMO_ID}`).set(doc);
}

// A rent-model-1 order: 19.99/wk × 4 weeks + the 9.99 insurance bundle = 89.95 subtotal.
const orderData = (overrides: any = {}) => ({
  orderId: 'promo-order-1',
  currency: 'usd',
  providerId: PROVIDER,
  rentalType: 'rent',
  bikeModel: 1,
  durationValue: 4,
  fees: [],
  ...overrides,
});

// Every one of these rejections lands before Stripe is contacted (resolveCoupon runs
// ahead of paymentIntents.create), so the suite needs no Stripe credentials — only a
// key that lets the client be constructed.
describe('promo codes at checkout', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedConfig({ secretKey: 'sk_test_placeholder' });
    await seedLogistics();
    await seedProvider(PROVIDER, { salesTaxRate: 0 });
  });

  test('refuses a code minted for another transaction type', async () => {
    await seedPromo({ offerType: 'buy' });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/only works on Buy orders/i);
  });

  test('refuses a rent-to-buy code on a plain rental', async () => {
    await seedPromo({ offerType: 'rentToBuy' });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/only works on Rent to Buy orders/i);
  });

  test('a promo with no offerType is rent-only, never a wildcard', async () => {
    await seedPromo({ offerType: undefined });
    await expect(callable(fns.createPaymentIntent, orderData({
      rentalType: 'buy', couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/only works on Rent orders/i);
  });

  test('refuses an unknown code', async () => {
    await seedPromo();
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'NOPE99',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/isn't valid/i);
  });

  test('refuses a deactivated campaign', async () => {
    await seedPromo({ isActive: false });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/isn't valid/i);
  });

  test('refuses a lapsed code', async () => {
    await seedPromo({ offerExpDate: dayFromNow(-1) });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/expired/i);
  });

  test('refuses a code carrying no discount', async () => {
    await seedPromo({ discountValue: 0 });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/doesn't carry a discount/i);
  });

  // ── Single use ───────────────────────────────────────────────────────────
  // `usedBy` on the promo is advisory (it drives the carousel); the guarantee is the
  // claim doc, which is written in a transaction before the card is authorized.

  test('refuses a code whose redemption claim is confirmed', async () => {
    await seedPromo();
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID, customerPhone: CUSTOMER, orderId: 'earlier-order', confirmed: true,
    });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/already used/i);
  });

  test('refuses a second checkout running against a live claim', async () => {
    await seedPromo();
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID,
      customerPhone: CUSTOMER,
      orderId: 'some-other-checkout',
      confirmed: false,
      claimedAt: new Date(),
    });
    await expect(callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER))).rejects.toThrow(/another checkout/i);
  });

  test('lets the SAME checkout retake its own claim on a retry', async () => {
    await seedPromo();
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID,
      customerPhone: CUSTOMER,
      orderId: 'promo-order-1',
      confirmed: false,
      claimedAt: new Date(),
    });
    // The call still fails further down (the placeholder Stripe key can't open a
    // PaymentIntent) — what matters is that it got PAST the coupon guard.
    const err = await callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER)).then(() => null, (e: any) => e);
    expect(String(err?.message)).not.toMatch(/another checkout|already used/i);
  });

  test('releases a claim left behind by an abandoned checkout', async () => {
    await seedPromo();
    const stale = new Date(Date.now() - 20 * 60 * 1000); // older than the 15-min TTL
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID,
      customerPhone: CUSTOMER,
      orderId: 'abandoned-checkout',
      confirmed: false,
      claimedAt: stale,
    });
    const err = await callable(fns.createPaymentIntent, orderData({
      couponCode: 'SAVE20',
    }), phoneAuth(CUSTOMER)).then(() => null, (e: any) => e);
    expect(String(err?.message)).not.toMatch(/another checkout|already used/i);
  });
});

describe('onOrderCreatedRedeemPromo', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedPromo();
  });

  const fire = (order: any, orderId = 'promo-order-1') =>
    triggerCreated(fns.onOrderCreatedRedeemPromo, `orders/${orderId}`, order, { orderId });

  test('confirms the claim and mirrors the redemption onto the CUSTOMER, not the promo', async () => {
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID, customerPhone: CUSTOMER, orderId: 'promo-order-1', confirmed: false,
    });

    await fire({ customerPhone: CUSTOMER, couponPromoId: PROMO_ID, couponCode: 'SAVE20' });

    expect((await getDoc(`promoRedemptions/${CLAIM_ID}`))?.confirmed).toBe(true);
    expect((await getDoc(`users/${CUSTOMER}`))?.redeemedPromoIds).toContain(PROMO_ID);
    // The promo is broadcast to every home screen — no redeemer roster may land on it.
    expect((await getDoc(`promos/${PROMO_ID}`))?.usedBy).toBeUndefined();
  });

  test('ignores an order that carried no promo', async () => {
    await fire({ customerPhone: CUSTOMER });
    expect(await getDoc(`promoRedemptions/${CLAIM_ID}`)).toBeNull();
    expect(await getDoc(`users/${CUSTOMER}`)).toBeNull();
  });

  test('will not take over a claim already confirmed for a different order', async () => {
    await db.doc(`promoRedemptions/${CLAIM_ID}`).set({
      promoId: PROMO_ID, customerPhone: CUSTOMER, orderId: 'the-real-one', confirmed: true,
    });

    await fire({ customerPhone: CUSTOMER, couponPromoId: PROMO_ID }, 'a-later-order');

    expect((await getDoc(`promoRedemptions/${CLAIM_ID}`))?.orderId).toBe('the-real-one');
  });
});
