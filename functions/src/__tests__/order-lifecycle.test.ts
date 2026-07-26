import {
  callable, fns, phoneAuth, seedConfig, seedProvider, seedUser, seedOrder,
  seedLogistics, getDoc, clearFirestore, spyExpo,
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
// The collection run that precedes a bike check-in: announce the trip, arrive, then
// either check the bike in or report nobody was home. The order stays DELIVERED
// throughout (the rental is still running), so progress lives on `returnStage`.
describe('collection run (Rental Due → bike check-in)', () => {
  // Local YYYY-MM-DD math, matching the server's (never `new Date('Y-M-D')`, which
  // parses as UTC midnight and rolls back a day in western zones).
  const day = (offsetDays: number) => {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  // A plain rent that is out with a customer: 4 weeks, due back in 10 days.
  const seedRunningRental = (id: string, extra: any = {}) => seedOrder(id, {
    providerId: PROVIDER_ID, providerName: 'Test Co', status: 'delivered',
    customerPhone: CUSTOMER_PHONE, rentalType: 'rent', bikeModel: 1,
    durationValue: 4, durationUnit: 'weeks', expectedEndDate: day(10),
    taxRate: 0, ...extra,
  });

  test('Ready for Pickup → stage set, customer told to be home', async () => {
    const expo = spyExpo();
    await seedLogistics();
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedRunningRental('p1');

    await callable(fns.startRentalPickup, { orderId: 'p1' }, phoneAuth(PROVIDER_PHONE));

    const o = await getDoc('orders/p1');
    expect(o.returnStage).toBe('ready_for_pickup');
    expect(o.status).toBe('delivered'); // the rental is still running
    const msgs = expo.messages();
    expo.restore();
    const msg = msgs.find(m => m.data?.type === 'PICKUP_ON_THE_WAY');
    expect(msg).toBeDefined();
    expect(msg.body).toMatch(/be home/i);
  });

  test('Mark at Location → on-site stage, arrival push', async () => {
    const expo = spyExpo();
    await seedLogistics();
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedRunningRental('p2', { returnStage: 'ready_for_pickup' });

    await callable(fns.markRentalPickupArrived, { orderId: 'p2' }, phoneAuth(PROVIDER_PHONE));

    const o = await getDoc('orders/p2');
    expect(o.returnStage).toBe('at_location');
    const msgs = expo.messages();
    expo.restore();
    expect(msgs.some(m => m.data?.type === 'PICKUP_ARRIVED')).toBe(true);
  });

  test('not present → rental renews a full term, admin fee added, run cleared', async () => {
    const expo = spyExpo();
    await seedLogistics();
    // No saved card, so the charge fails before Stripe is ever constructed — the
    // renewal must still go through, since the customer still has the bike.
    await seedUser(CUSTOMER_PHONE, { fcmToken: 'ExponentPushToken[cust]' });
    await seedRunningRental('p3', { returnStage: 'at_location' });

    const res: any = await callable(fns.recordRentalPickupFailed, { orderId: 'p3' }, phoneAuth(PROVIDER_PHONE));

    // Renewed from the due-back date by the committed term (4 weeks = 28 days).
    expect(res.renewedTo).toBe(day(38));
    expect(res.adminFee).toBe(25);
    expect(res.total ?? res.rentalCharge + res.adminFee).toBeGreaterThan(25);
    expect(res.error).toMatch(/no saved card/i);
    expect(res.charged).toBe(0);

    const o = await getDoc('orders/p3');
    expect(o.expectedEndDate).toBe(day(38));
    expect(o.status).toBe('delivered');
    expect(o.returnStage).toBeNull();       // the run is over; the next one starts fresh
    expect(o.missedPickups).toBe(1);
    expect(o.renewalChargedTotal).toBe(0);  // nothing was actually collected
    expect(o.pickupAttempts).toHaveLength(1);
    expect(o.pickupAttempts[0].adminFee).toBe(25);
    expect(o.pickupAttempts[0].renewedTo).toBe(day(38));
    expect(o.pickupAttempts[0].error).toMatch(/no saved card/i);

    const msgs = expo.messages();
    expo.restore();
    expect(msgs.some(m => m.data?.type === 'PICKUP_MISSED')).toBe(true);
  });

  test('an overdue bike renews from today, not from the date already missed', async () => {
    await seedLogistics();
    await seedUser(CUSTOMER_PHONE);
    await seedRunningRental('p4', { expectedEndDate: day(-30) });

    const res: any = await callable(fns.recordRentalPickupFailed, { orderId: 'p4' }, phoneAuth(PROVIDER_PHONE));
    expect(res.renewedTo).toBe(day(28));
  });

  test('rent-to-buy and not-yet-delivered orders have no collection run', async () => {
    await seedLogistics();
    await seedOrder('p5', { status: 'delivered', rentalType: 'rentToBuy', bikeModel: 1 });
    await seedOrder('p6', { status: 'ready_for_delivery', rentalType: 'rent', bikeModel: 1 });

    await expect(callable(fns.startRentalPickup, { orderId: 'p5' }, phoneAuth(PROVIDER_PHONE)))
      .rejects.toThrow(/plain rental/i);
    await expect(callable(fns.startRentalPickup, { orderId: 'p6' }, phoneAuth(PROVIDER_PHONE)))
      .rejects.toThrow(/out with a customer/i);
  });
});

// NOTE: the adjustOrderFinalPrice describe block was removed — that callable no
// longer exists in index.ts (the load-based price-adjustment feature was dropped),
// so these tests could not compile and blocked the whole suite from running. If a
// price-adjustment callable is reintroduced, restore equivalent coverage here.
