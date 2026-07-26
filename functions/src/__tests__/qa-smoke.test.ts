/**
 * QA SMOKE SUITE — broad, black-box, cheap checks over the whole function surface.
 *
 * Complements the deep behavioural suites (order-lifecycle / triggers / payments)
 * with three things they don't cover:
 *
 *   1. AUTH GUARDS   — every callable that is supposed to require auth rejects an
 *                      unauthenticated call. This is the first line of defense and
 *                      the cheapest thing to regress.
 *   2. INPUT GUARDS  — a few representative invalid-argument paths reject before
 *                      touching Stripe / doing writes.
 *   3. CRON SAFETY   — every onSchedule job runs to completion against an EMPTY
 *                      database without throwing (no unhandled rejection, no crash
 *                      on "nothing to do"). This is the fast canary for the
 *                      unbounded-scan crons.
 *
 * Runs on the Firestore + Auth emulator via `npm run qa` (see package.json).
 * No Stripe key required: every assertion here fails BEFORE any Stripe call.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import {
  test as fft, fns, phoneAuth, adminAuth, seedConfig, seedUser, clearFirestore, spyExpo,
} from './helpers';

beforeEach(async () => {
  await clearFirestore();
  await seedConfig();
});

// Invoke a callable with NO auth context and return the rejection reason.
async function callNoAuth(fn: any, data: any = {}) {
  const wrapped: any = fft.wrap(fn);
  return wrapped({ data, auth: undefined });
}

// Run an onSchedule cron the way Cloud Scheduler would (empty event payload).
async function runCron(fn: any) {
  const wrapped: any = fft.wrap(fn);
  return wrapped({});
}

// ── 1. AUTH GUARDS ──────────────────────────────────────────────────────────
// Each of these callables must reject an unauthenticated caller. bulkBroadcast
// additionally requires the admin claim, so it rejects with permission-denied.
describe('auth guards — unauthenticated callers are rejected', () => {
  const AUTH_REQUIRED: Array<[string, any]> = [
    ['createPaymentIntent', fns.createPaymentIntent],
    ['claimOrder', fns.claimOrder],
    ['capturePaymentIntent', fns.capturePaymentIntent],
    ['saveProviderBillingCard', fns.saveProviderBillingCard],
    ['saveCustomerBillingCard', fns.saveCustomerBillingCard],
    ['getOrderNote', fns.getOrderNote],
    ['setOrderNote', fns.setOrderNote],
    ['submitOrderRating', fns.submitOrderRating],
    ['createTipPaymentIntent', fns.createTipPaymentIntent],
    ['cancelOrder', fns.cancelOrder],
    ['incrementPromoViews', fns.incrementPromoViews],
    ['assignBikeToOrder', fns.assignBikeToOrder],
    ['markRentalDelivered', fns.markRentalDelivered],
    ['startRentalPickup', fns.startRentalPickup],
    ['markRentalPickupArrived', fns.markRentalPickupArrived],
    ['recordRentalPickupFailed', fns.recordRentalPickupFailed],
    ['markRentalReturned', fns.markRentalReturned],
    ['chargeDeposit', fns.chargeDeposit],
    ['payoffRentToBuy', fns.payoffRentToBuy],
    ['recordOrderCard', fns.recordOrderCard],
    ['updateProviderLocationAndStatus', fns.updateProviderLocationAndStatus],
    ['bulkBroadcast', fns.bulkBroadcast],
  ];

  test.each(AUTH_REQUIRED)('%s rejects when request.auth is missing', async (_name, fn) => {
    await expect(callNoAuth(fn, { orderId: 'x', amount: 1 })).rejects.toMatchObject({
      code: expect.stringMatching(/unauthenticated|permission-denied/),
    });
  });

  test('bulkBroadcast rejects a NON-admin authenticated caller (permission-denied)', async () => {
    const wrapped: any = fft.wrap(fns.bulkBroadcast);
    await expect(
      wrapped({ data: { title: 't', body: 'b' }, auth: phoneAuth('+14025550000') }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });
});

// ── 2. INPUT GUARDS ─────────────────────────────────────────────────────────
describe('input validation guards', () => {
  test('createPaymentIntent rejects a non-positive amount before any Stripe call', async () => {
    const wrapped: any = fft.wrap(fns.createPaymentIntent);
    await expect(
      wrapped({
        data: { amount: 0, currency: 'usd', orderId: 'x', providerId: 'broadcast', zipCode: '11743' },
        auth: phoneAuth('+14025550000'),
      }),
    ).rejects.toBeInstanceOf(HttpsError);
  });

  test('submitOrderRating rejects a rating outside 1..5', async () => {
    const wrapped: any = fft.wrap(fns.submitOrderRating);
    await expect(
      wrapped({ data: { orderId: 'o1', rating: 9 }, auth: phoneAuth('+14025550000') }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('setOrderNote rejects a missing orderId (invalid-argument)', async () => {
    const wrapped: any = fft.wrap(fns.setOrderNote);
    await expect(
      wrapped({ data: { notes: 'hi' }, auth: phoneAuth('+14025550000') }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  test('createTipPaymentIntent rejects a non-positive tip', async () => {
    const wrapped: any = fft.wrap(fns.createTipPaymentIntent);
    await expect(
      wrapped({ data: { orderId: 'o1', tipAmount: 0 }, auth: phoneAuth('+14025550000') }),
    ).rejects.toBeInstanceOf(HttpsError);
  });
});

// ── 3. CRON SAFETY (empty database) ─────────────────────────────────────────
// Each scheduled job must no-op cleanly when there is nothing due. A throw here
// means an unguarded read/loop that would fail the real scheduled run.
describe('scheduled jobs run cleanly against an empty database', () => {
  test('cleanupExpiredPromos', async () => { await expect(runCron(fns.cleanupExpiredPromos)).resolves.not.toThrow(); });
  test('expireStaleOrders', async () => { await expect(runCron(fns.expireStaleOrders)).resolves.not.toThrow(); });
  test('scheduledDepositRelease', async () => { await expect(runCron(fns.scheduledDepositRelease)).resolves.not.toThrow(); });
  test('chargeRentToBuyInstallments', async () => { await expect(runCron(fns.chargeRentToBuyInstallments)).resolves.not.toThrow(); });
});

// ── 3b. bulkBroadcast paginated fan-out ─────────────────────────────────────
describe('bulkBroadcast streams the target collection', () => {
  test('pushes to every recipient with a token; skips those without', async () => {
    const expo = spyExpo();
    await seedUser('+15550000001', { fcmToken: 'ExponentPushToken[a]' });
    await seedUser('+15550000002', { fcmToken: 'ExponentPushToken[b]' });
    await seedUser('+15550000003', {}); // no token → scanned but not messaged

    const wrapped: any = fft.wrap(fns.bulkBroadcast);
    const res: any = await wrapped({
      data: { title: 'Hi', body: 'Message', target: 'customers' },
      auth: adminAuth(),
    });
    const recips = expo.messages().filter((m) => m.data?.type === 'BULK').map((m) => m.to).sort();
    expo.restore();

    expect(res.scanned).toBe(3);
    expect(res.withToken).toBe(2);
    expect(recips).toEqual(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
  });
});

