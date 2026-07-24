/**
 * Aggregate-counts maintenance tests.
 *
 * Verifies the stats/platformCounts doc that the admin console reads instead of
 * streaming whole collections. Covers the order buckets, the license-review queue
 * count, and the provider total.
 */
import {
  triggerCreated, triggerUpdated, fns, seedConfig, getDoc, clearFirestore,
} from './helpers';

// onDocumentWritten harness: build a before/after change from two data states.
async function triggerWritten(fn: any, refPath: string, before: any, after: any, params: Record<string, string>) {
  const { test } = await import('./helpers');
  const wrapped: any = test.wrap(fn);
  const beforeSnap = test.firestore.makeDocumentSnapshot(before, refPath);
  const afterSnap = test.firestore.makeDocumentSnapshot(after, refPath);
  return wrapped({ data: test.makeChange(beforeSnap, afterSnap), params });
}

const COUNTS = 'stats/platformCounts';

beforeEach(async () => {
  await clearFirestore();
  await seedConfig();
});

describe('platformCounts — orders', () => {
  test('order create increments ordersTotal and the status bucket', async () => {
    await triggerCreated(fns.onOrderCreatedUpdateStats, 'orders/o1',
      { id: 'o1', providerId: 'broadcast', status: 'requested', createdAt: new Date().toISOString() },
      { orderId: 'o1' });

    const c = await getDoc(COUNTS);
    expect(c.ordersTotal).toBe(1);
    expect(c.ordersByStatus.requested).toBe(1);
  });

  test('status change moves the count between buckets', async () => {
    const providerId = '14025551111_11743';
    await triggerUpdated(fns.onOrderUpdatedUpdateStats, 'orders/o2',
      { id: 'o2', providerId, status: 'requested' },
      { id: 'o2', providerId, status: 'confirmed' },
      { orderId: 'o2' });

    const c = await getDoc(COUNTS);
    expect(c.ordersByStatus.requested).toBe(-1); // decremented out of requested
    expect(c.ordersByStatus.confirmed).toBe(1);  // incremented into confirmed
  });
});

describe('platformCounts — license review queue', () => {
  const phone = '+14025550000';

  test('a newly-uploaded, unreviewed license increments pendingLicenses', async () => {
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone },
      { phoneNumber: phone, driverLicense: { frontPath: 'lic/front.jpg' } },
      { phone });

    const c = await getDoc(COUNTS);
    expect(c.pendingLicenses).toBe(1);
  });

  test('reviewing a pending license decrements pendingLicenses', async () => {
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone, driverLicense: { frontPath: 'lic/front.jpg' } },
      { phoneNumber: phone, driverLicense: { frontPath: 'lic/front.jpg', reviewedAt: new Date().toISOString() } },
      { phone });

    const c = await getDoc(COUNTS);
    expect(c.pendingLicenses).toBe(-1);
  });

  test('an unrelated profile edit does not touch pendingLicenses', async () => {
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone, name: 'Old' },
      { phoneNumber: phone, name: 'New' },
      { phone });

    const c = await getDoc(COUNTS);
    expect(c?.pendingLicenses ?? 0).toBe(0);
  });
});

describe('platformCounts — providers', () => {
  test('provider creation increments providersTotal', async () => {
    await triggerCreated(fns.onProviderCreatedLifecycleEmails, 'providers/14025551111_11743',
      { businessName: 'Test Co', phoneNumber: '14025551111' },
      { providerId: '14025551111_11743' });

    const c = await getDoc(COUNTS);
    expect(c.providersTotal).toBe(1);
  });
});
