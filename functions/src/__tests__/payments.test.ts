import Stripe from 'stripe';
import {
  callable, fns, phoneAuth, seedConfig, seedProvider, seedOrder, getDoc, clearFirestore,
} from './helpers';

const CUSTOMER = '+14025550000';

// Validation that runs before getStripe (no Stripe key required). The server
// re-derives the price from the customer's selections against apiConfig/logistics
// — a client-sent `amount` is never trusted — so the real first-line guards are on
// the pickup provider and the rental type.
describe('createPaymentIntent validation', () => {
  beforeEach(async () => { await clearFirestore(); await seedConfig(); });

  test('rejects an unclaimed/broadcast pickup (no provider selected)', async () => {
    await expect(callable(fns.createPaymentIntent, {
      orderId: 'x', currency: 'usd', providerId: 'broadcast', rentalType: 'rent',
    }, phoneAuth(CUSTOMER))).rejects.toThrow(/pickup location must be selected/i);
  });

  test('rejects an invalid rental type', async () => {
    await expect(callable(fns.createPaymentIntent, {
      orderId: 'x', currency: 'usd', providerId: '14025551111_11743', rentalType: 'lease',
    }, phoneAuth(CUSTOMER))).rejects.toThrow(/invalid rental type/i);
  });
});

// Real Stripe test-mode money path. Opt-in: set STRIPE_TEST_KEY=sk_test_... before
// `npm test`. Skipped (not failed) when the key is absent so the suite stays green
// in environments without Stripe credentials.
const STRIPE_TEST_KEY = process.env.STRIPE_TEST_KEY;
const describeStripe = STRIPE_TEST_KEY ? describe : describe.skip;
if (!STRIPE_TEST_KEY) {
  // eslint-disable-next-line no-console
  console.log('[payments] STRIPE_TEST_KEY not set — skipping live Stripe test-mode flow.');
}

describeStripe('Stripe payment flow (test mode)', () => {
  const stripe = new Stripe(STRIPE_TEST_KEY || 'sk_test_placeholder', { apiVersion: '2024-04-10' as any });

  beforeEach(async () => {
    await clearFirestore();
    await seedConfig({ secretKey: STRIPE_TEST_KEY });
    await seedProvider('14025551111_11743', { salesTaxRate: 0 });
  });

  test('createPaymentIntent opens a manual-capture hold equal to the computed total', async () => {
    const res: any = await callable(fns.createPaymentIntent, {
      amount: 50, currency: 'usd', orderId: 'pay1', providerId: 'broadcast',
      zipCode: '11743', isPickupDelivery: false, customerAddress: '1 Main St 11743',
    }, phoneAuth(CUSTOMER));

    expect(res.paymentIntentId).toMatch(/^pi_/);
    expect(res.pricing.total).toBeGreaterThan(50);

    const pi = await stripe.paymentIntents.retrieve(res.paymentIntentId);
    expect(pi.capture_method).toBe('manual');
    expect(pi.amount).toBe(Math.round(res.pricing.total * 100));
    expect(pi.status).toBe('requires_payment_method');
  });

  test('authorize → confirm card → capture settles the exact breakdown', async () => {
    const res: any = await callable(fns.createPaymentIntent, {
      amount: 50, currency: 'usd', orderId: 'pay2', providerId: 'broadcast',
      zipCode: '11743', isPickupDelivery: false, customerAddress: '1 Main St 11743',
    }, phoneAuth(CUSTOMER));

    // Customer authorizes with a Stripe test card (held, not captured).
    const confirmed = await stripe.paymentIntents.confirm(res.paymentIntentId, {
      payment_method: 'pm_card_visa',
      return_url: 'https://example.com/return',
    });
    expect(confirmed.status).toBe('requires_capture');

    await seedOrder('pay2', {
      providerId: '14025551111_11743', status: 'confirmed',
      paymentIntentId: res.paymentIntentId, estimatedPrice: res.pricing.total,
      finalPrice: res.pricing.total, customerPhone: CUSTOMER,
    });

    await callable(fns.capturePaymentIntent, { orderId: 'pay2' }, phoneAuth('+14025551111'));

    const order = await getDoc('orders/pay2');
    expect(order.paymentCaptured).toBe(true);

    const captured = await stripe.paymentIntents.retrieve(res.paymentIntentId);
    expect(captured.status).toBe('succeeded');
    expect(captured.amount_received).toBe(Math.round(res.pricing.total * 100));
  });
});
