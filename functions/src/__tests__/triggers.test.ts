import {
  triggerCreated, triggerUpdated, fns, seedConfig, seedProvider, seedOrder, seedUser,
  db, getDoc, clearFirestore, spyExpo, test as fft,
} from './helpers';

const ZIP = '11743';

// onDocumentWritten harness: build a before/after change from two data states.
async function triggerWritten(fn: any, refPath: string, before: any, after: any, params: Record<string, string>) {
  const wrapped: any = fft.wrap(fn);
  const beforeSnap = fft.firestore.makeDocumentSnapshot(before, refPath);
  const afterSnap = fft.firestore.makeDocumentSnapshot(after, refPath);
  return wrapped({ data: fft.makeChange(beforeSnap, afterSnap), params });
}

beforeEach(async () => {
  await clearFirestore();
  await seedConfig();
});

describe('onOrderCreatedNotify (broadcast fan-out)', () => {
  test('notifies only onboarded, active, in-zip providers', async () => {
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[A]' });                         // eligible
    await seedProvider('14025552222_11743', { fcmToken: 'ExponentPushToken[B]', isBlocked: true });        // blocked
    await seedProvider('14025553333_11743', { fcmToken: 'ExponentPushToken[C]', servicesActive: false });  // paused
    await seedProvider('14025554444_10001', { fcmToken: 'ExponentPushToken[D]', zipCode: '10001' });       // other zip

    const expo = spyExpo();
    const order = { id: 'b1', providerId: 'broadcast', zipCode: ZIP, status: 'requested', createdAt: new Date().toISOString() };
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/b1', order, { orderId: 'b1' });
    const msgs = expo.messages();
    expo.restore();

    const recipients = msgs.filter(m => m.data?.type === 'BROADCAST_ORDER').map(m => m.to);
    expect(recipients).toEqual(['ExponentPushToken[A]']);
  });

  test('direct order pings only the assigned provider with DIRECT_ORDER', async () => {
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[A]' });
    const expo = spyExpo();
    const order = { id: 'd1', providerId: '14025551111_11743', zipCode: ZIP, status: 'requested', createdAt: new Date().toISOString() };
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/d1', order, { orderId: 'd1' });
    const msgs = expo.messages();
    expo.restore();

    expect(msgs.length).toBe(1);
    expect(msgs[0].data.type).toBe('DIRECT_ORDER');
    expect(msgs[0].to).toBe('ExponentPushToken[A]');
  });

  test('broadcast caps at the 25 closest in-radius providers', async () => {
    // 30 eligible providers on a line, each one farther from the anchor than the last
    // (lat grows by ~0.69mi per step), all comfortably inside the radius.
    const anchorLat = 40.0, anchorLng = -73.0;
    for (let i = 1; i <= 30; i++) {
      await seedProvider(`1402555${1000 + i}_11743`, {
        fcmToken: `ExponentPushToken[P${i}]`,
        lat: anchorLat + i * 0.01,
        lng: anchorLng,
      });
    }

    const expo = spyExpo();
    const order = {
      id: 'cap1', providerId: 'broadcast', status: 'requested', zipCode: ZIP,
      customerLat: anchorLat, customerLng: anchorLng, broadcastRadius: 100,
      createdAt: new Date().toISOString(),
    };
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/cap1', order, { orderId: 'cap1' });
    const recipients = expo.messages().filter(m => m.data?.type === 'BROADCAST_ORDER').map(m => m.to);
    expo.restore();

    // Only the 25 closest (P1..P25) are notified; the 5 farthest (P26..P30) are dropped.
    expect(recipients.length).toBe(25);
    const expected = new Set(Array.from({ length: 25 }, (_, i) => `ExponentPushToken[P${i + 1}]`));
    expect(new Set(recipients)).toEqual(expected);
    expect(recipients).not.toContain('ExponentPushToken[P26]');
    expect(recipients).not.toContain('ExponentPushToken[P30]');
  });
});

describe('onCustomerMessageSent', () => {
  test('customer message notifies the assigned provider', async () => {
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[A]' });
    await seedOrder('o1', { providerId: '14025551111_11743', customerName: 'Cust' });
    const expo = spyExpo();

    const msg = { senderRole: 'customer', orderId: 'o1', text: 'where are you?' };
    await triggerCreated(fns.onCustomerMessageSent, 'messages/m1', msg, { messageId: 'm1' });
    const msgs = expo.messages();
    expo.restore();

    const m = msgs.find(x => x.data?.type === 'NEW_CUSTOMER_MESSAGE');
    expect(m).toBeDefined();
    expect(m.to).toBe('ExponentPushToken[A]');
    expect(m.body).toMatch(/where are you/);
  });

  test('provider-role message does not fire this trigger', async () => {
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[A]' });
    await seedOrder('o2', { providerId: '14025551111_11743' });
    const expo = spyExpo();
    await triggerCreated(fns.onCustomerMessageSent, 'messages/m2', { senderRole: 'provider', orderId: 'o2', text: 'hi' }, { messageId: 'm2' });
    const msgs = expo.messages();
    expo.restore();
    expect(msgs.length).toBe(0);
  });
});

describe('onOrderCancelledNotifyProvider', () => {
  test('status → cancelled notifies the assigned provider', async () => {
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[A]' });
    const expo = spyExpo();
    const before = { providerId: '14025551111_11743', status: 'confirmed' };
    const after = { providerId: '14025551111_11743', status: 'cancelled' };
    await triggerUpdated(fns.onOrderCancelledNotifyProvider, 'orders/x1', before, after, { orderId: 'x1' });
    const msgs = expo.messages();
    expo.restore();
    expect(msgs.some(m => m.data?.type === 'ORDER_CANCELLED' && m.to === 'ExponentPushToken[A]')).toBe(true);
  });

  test('broadcast (unclaimed) cancel notifies no one', async () => {
    const expo = spyExpo();
    await triggerUpdated(fns.onOrderCancelledNotifyProvider, 'orders/x2',
      { providerId: 'broadcast', status: 'requested' }, { providerId: 'broadcast', status: 'cancelled' }, { orderId: 'x2' });
    const msgs = expo.messages();
    expo.restore();
    expect(msgs.length).toBe(0);
  });
});

describe('onOrderCreatedUpdateStats', () => {
  test('records a provider attempt and a daily order count', async () => {
    const providerId = '14025551111_11743';
    const order = { id: 's1', providerId, status: 'requested', createdAt: new Date().toISOString() };
    await triggerCreated(fns.onOrderCreatedUpdateStats, 'orders/s1', order, { orderId: 's1' });

    const perf = await getDoc(`providerPerformance/${providerId}`);
    expect(perf.totalAttempts).toBe(1);
    const today = new Date().toISOString().split('T')[0];
    const daily = await getDoc(`stats/${today}`);
    expect(daily.orderCount).toBe(1);
  });
});

describe('notifyDocsRejected (piggybacked on onUserWriteLifecycleEmails)', () => {
  const phone = '+14025550000';
  const REASON = 'Your identity check was rejected. Please re-upload your driver license and a different proof of address.';
  const docs = (extra: any = {}) => ({
    driverLicense: { frontPath: 'l/f.jpg', backPath: 'l/b.jpg', uploadedAt: '2026-07-01T00:00:00.000Z', ...extra },
    addressProof: { frontPath: 'a/f.jpg', uploadedAt: '2026-07-01T00:00:00.000Z', ...extra },
  });

  test('staff rejecting the pair pushes ID_DOCS_REJECTED to the customer', async () => {
    await seedUser(phone, { fcmToken: 'ExponentPushToken[cust]' });
    const expo = spyExpo();
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone, ...docs() },
      { phoneNumber: phone, ...docs({ reviewedAt: null, rejectedReason: REASON }) },
      { phone });
    const msgs = expo.messages();
    expo.restore();

    const push = msgs.find(m => m.data?.type === 'ID_DOCS_REJECTED');
    expect(push?.to).toBe('ExponentPushToken[cust]');
    expect(push?.body).toContain('different proof of address');
  });

  test('a later profile write on an already-rejected customer does not re-push', async () => {
    await seedUser(phone, { fcmToken: 'ExponentPushToken[cust]' });
    const expo = spyExpo();
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone, badgeCount: 1, ...docs({ reviewedAt: null, rejectedReason: REASON }) },
      { phoneNumber: phone, badgeCount: 2, ...docs({ reviewedAt: null, rejectedReason: REASON }) },
      { phone });
    const msgs = expo.messages();
    expo.restore();

    expect(msgs.some(m => m.data?.type === 'ID_DOCS_REJECTED')).toBe(false);
  });

  test('re-uploading after a rejection notifies the store, not the customer', async () => {
    await seedUser(phone, { fcmToken: 'ExponentPushToken[cust]', name: 'Cust' });
    await seedProvider('14025551111_11743', { fcmToken: 'ExponentPushToken[store]' });
    await seedOrder('order_r1', { customerPhone: phone, providerId: '14025551111_11743', status: 'confirmed', idRequestedAt: '2026-07-01T00:00:00.000Z' });
    const expo = spyExpo();
    await triggerWritten(fns.onUserWriteLifecycleEmails, `users/${phone}`,
      { phoneNumber: phone, ...docs({ reviewedAt: null, rejectedReason: REASON }) },
      {
        phoneNumber: phone,
        driverLicense: { frontPath: 'l/f2.jpg', backPath: 'l/b2.jpg', uploadedAt: '2026-07-02T00:00:00.000Z', reviewedAt: null, rejectedReason: null },
        addressProof: { frontPath: 'a/f2.jpg', uploadedAt: '2026-07-02T00:00:00.000Z', reviewedAt: null, rejectedReason: null },
      },
      { phone });
    const msgs = expo.messages();
    expo.restore();

    expect(msgs.some(m => m.data?.type === 'ID_DOCS_REJECTED')).toBe(false);
    expect(msgs.some(m => m.data?.type === 'ID_DOCS_UPLOADED' && m.to === 'ExponentPushToken[store]')).toBe(true);
  });
});
