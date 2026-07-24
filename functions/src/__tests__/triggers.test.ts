import {
  triggerCreated, triggerUpdated, fns, seedConfig, seedProvider, seedOrder,
  db, getDoc, clearFirestore, spyExpo,
} from './helpers';

const ZIP = '11743';

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
