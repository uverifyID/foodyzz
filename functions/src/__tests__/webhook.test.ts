import Stripe from 'stripe';
import { fns, seedConfig, seedOrder, getDoc, clearFirestore } from './helpers';

// stripeWebhook's payment_intent.payment_failed branch. Every order-side charge
// carries the same orderId, so only a failed BASE rental charge may cancel an order.
// These cases all resolve before the handler calls Stripe, so no key is needed.
const WEBHOOK_SECRET = 'whsec_test';
const signer = new Stripe('sk_test_placeholder', { apiVersion: '2024-04-10' as any });

async function deliver(type: string, intent: Record<string, any>) {
  const payload = JSON.stringify({
    id: 'evt_test', object: 'event', type,
    data: { object: { id: 'pi_test', object: 'payment_intent', last_payment_error: { message: 'Your card was declined.' }, ...intent } },
  });
  const signature = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  const req: any = { headers: { 'stripe-signature': signature }, rawBody: Buffer.from(payload) };
  const res: any = { statusCode: 200, body: undefined as any };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  res.send = (body: any) => { res.body = body; return res; };
  await (fns.stripeWebhook as any)(req, res);
  return res;
}

describe('stripeWebhook payment_intent.payment_failed', () => {
  beforeEach(async () => {
    await clearFirestore();
    await seedConfig({ secretKey: 'sk_test_placeholder' });
  });

  test.each(['security_deposit', 'rental_renewal', 'rent_to_buy_installment'])(
    'a failed %s charge leaves the live rental alone',
    async (kind) => {
      await seedOrder('order_live', { status: 'delivered', paymentIntentId: 'pi_base', paymentCaptured: true });
      const res = await deliver('payment_intent.payment_failed', { id: 'pi_side', metadata: { orderId: 'order_live', kind } });
      expect(res.statusCode).toBe(200);
      const order = await getDoc('orders/order_live');
      expect(order.status).toBe('delivered');
      expect(order.paymentError).toBeUndefined();
    },
  );

  test('a failed tip leaves the delivered order alone', async () => {
    await seedOrder('order_tip', { status: 'delivered', paymentIntentId: 'pi_base', paymentCaptured: true });
    await deliver('payment_intent.payment_failed', { id: 'pi_tip', metadata: { orderId: 'order_tip', tip: 'true' } });
    expect((await getDoc('orders/order_tip')).status).toBe('delivered');
  });

  test('a checkout decline before the order exists is acknowledged, not a 500', async () => {
    const res = await deliver('payment_intent.payment_failed', { id: 'pi_new', metadata: { orderId: 'order_not_yet' } });
    expect(res.statusCode).toBe(200);
    expect(await getDoc('orders/order_not_yet')).toBeNull();
  });

  test('a stale failure on a different intent does not cancel the paid order', async () => {
    // The customer was declined on one attempt, then paid on the intent the order holds.
    await seedOrder('order_retry', { status: 'requested', paymentIntentId: 'pi_paid' });
    await deliver('payment_intent.payment_failed', { id: 'pi_declined', metadata: { orderId: 'order_retry' } });
    expect((await getDoc('orders/order_retry')).status).toBe('requested');
  });

  test('a failure on an already-captured charge is ignored', async () => {
    await seedOrder('order_cap', { status: 'confirmed', paymentIntentId: 'pi_test', paymentCaptured: true });
    await deliver('payment_intent.payment_failed', { metadata: { orderId: 'order_cap' } });
    expect((await getDoc('orders/order_cap')).status).toBe('confirmed');
  });
});
