import {
  callable, fns, phoneAuth, seedConfig, seedProvider, seedUser, seedOrder,
  getDoc, clearFirestore, spyExpo,
} from './helpers';

const PROVIDER_ID = '14025551111_11743';
const PROVIDER_PHONE = '+14025551111';
const CUSTOMER_PHONE = '+14025550000';

beforeEach(async () => {
  await clearFirestore();
  await seedConfig();
});

describe('claimOrder', () => {
  // A rental is quoted in full at checkout and is NEVER re-priced on accept
  // (see the claimOrder comment in index.ts): the authorized amount is exactly
  // what will be captured on delivery. So claiming only assigns the provider and
  // moves the order to CONFIRMED — there is no settlement/re-auth step, and the
  // authorized total (estimatedPrice) is left untouched.
  test('broadcast order → assigned + confirmed, authorized total unchanged', async () => {
    await seedProvider(PROVIDER_ID, { salesTaxRate: 0 });
    await seedOrder('o1', { providerId: 'broadcast', estimatedPrice: 100, orderSubtotal: 80 });

    await callable(fns.claimOrder, {
      orderId: 'o1', providerId: PROVIDER_ID, providerName: 'Test Co', providerPhone: '14025551111',
    }, phoneAuth(PROVIDER_PHONE));

    const o = await getDoc('orders/o1');
    expect(o.status).toBe('confirmed');
    expect(o.providerId).toBe(PROVIDER_ID);
    expect(o.providerName).toBe('Test Co');
    // The authorized ceiling is preserved; no re-pricing happens on accept.
    expect(o.estimatedPrice).toBe(100);
    expect(o.confirmedAt).toBeTruthy();
  });

  test('order no longer REQUESTED → failed-precondition', async () => {
    await seedProvider(PROVIDER_ID);
    await seedOrder('o3', { providerId: 'broadcast', status: 'confirmed' });

    await expect(callable(fns.claimOrder, {
      orderId: 'o3', providerId: PROVIDER_ID, providerName: 'Test Co', providerPhone: '14025551111',
    }, phoneAuth(PROVIDER_PHONE))).rejects.toThrow(/no longer available/i);
  });

  test('confirmed claim notifies the customer with ORDER_CONFIRMED', async () => {
    const expo = spyExpo();
    await seedProvider(PROVIDER_ID, { salesTaxRate: 0 });
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedOrder('o4', { providerId: 'broadcast', estimatedPrice: 100, orderSubtotal: 80, customerPhone: CUSTOMER_PHONE });

    await callable(fns.claimOrder, {
      orderId: 'o4', providerId: PROVIDER_ID, providerName: 'Test Co', providerPhone: '14025551111',
    }, phoneAuth(PROVIDER_PHONE));

    const msgs = expo.messages();
    expo.restore();
    expect(msgs.some(m => m.data?.type === 'ORDER_CONFIRMED' && m.to === 'ExponentPushToken[cust]')).toBe(true);
  });
});

describe('cancelOrder', () => {
  test('provider cancels → cancelled, stats increment, customer notified "by Provider"', async () => {
    const expo = spyExpo();
    await seedProvider(PROVIDER_ID);
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedOrder('c1', { providerId: PROVIDER_ID, status: 'confirmed', customerPhone: CUSTOMER_PHONE });

    await callable(fns.cancelOrder, { orderId: 'c1', reason: 'too busy' }, phoneAuth(PROVIDER_PHONE));

    const o = await getDoc('orders/c1');
    expect(o.status).toBe('cancelled');
    const stats = await getDoc(`providerCancellations/${PROVIDER_ID}`);
    expect(stats.count).toBe(1);

    const msgs = expo.messages();
    expo.restore();
    const cancelMsg = msgs.find(m => m.data?.type === 'ORDER_CANCELLED');
    expect(cancelMsg).toBeDefined();
    expect(cancelMsg.title).toMatch(/by Provider/i);
    expect(cancelMsg.body).toMatch(/too busy/);
  });

  test('customer cancels own order → cancelled, no stats, no self-notification', async () => {
    const expo = spyExpo();
    await seedProvider(PROVIDER_ID);
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedOrder('c2', { providerId: PROVIDER_ID, status: 'confirmed', customerPhone: CUSTOMER_PHONE });

    await callable(fns.cancelOrder, { orderId: 'c2' }, phoneAuth(CUSTOMER_PHONE));

    const o = await getDoc('orders/c2');
    expect(o.status).toBe('cancelled');
    expect(await getDoc(`providerCancellations/${PROVIDER_ID}`)).toBeNull();
    const msgs = expo.messages();
    expo.restore();
    expect(msgs.some(m => m.data?.type === 'ORDER_CANCELLED')).toBe(false);
  });

  test('terminal-state order → failed-precondition', async () => {
    await seedOrder('c3', { providerId: PROVIDER_ID, status: 'delivered' });
    await expect(callable(fns.cancelOrder, { orderId: 'c3' }, phoneAuth(PROVIDER_PHONE)))
      .rejects.toThrow(/terminal/i);
  });
});
// NOTE: the adjustOrderFinalPrice describe block was removed — that callable no
// longer exists in index.ts (the load-based price-adjustment feature was dropped),
// so these tests could not compile and blocked the whole suite from running. If a
// price-adjustment callable is reintroduced, restore equivalent coverage here.
