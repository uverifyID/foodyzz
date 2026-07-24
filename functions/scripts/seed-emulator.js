// Seeds the Firestore emulator with the minimum data an E2E run needs:
// global config, one onboarded provider, one customer, and an open broadcast order.
//
// Run against a RUNNING emulator, e.g.:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo-foodyzz \
//     node scripts/seed-emulator.js
// or via:  npm run seed:emulator   (after `firebase emulators:start`)
const admin = require('firebase-admin');

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — start the emulator first (firebase emulators:start).');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'demo-foodyzz' });
const db = admin.firestore();

(async () => {
  await db.doc('apiConfig/global').set({
    chargePerLoad: 15, chargePerLb: 1.5, commissionRate: 0.2, commissionRates: 0.2,
    minimumCommission: 5, promoCostPerCount: 1,
    deliveryFee: { radius: 5, pickupDelivery: 8 },
    apiKeys: { googleMap: 'test-maps-key' },
    stripe: { merchantId: 'acct_test', publishableKey: 'pk_test_x', transactionFee: 0.3, processingFee: 0.029 },
    managerProgram: {
      defaultCommissionRate: 0.3,
      recruitBonus: { months: 3, bonusRate: 0.05 },
      portalUrl: 'http://localhost:3000',
      minPayout: 10,
      adhocFee: 1.99,
    },
  });
  await db.doc('providers/14025551111_11743').set({
    phoneNumber: '14025551111', zipCode: '11743', onboarded: true, servicesActive: true,
    isBlocked: false, businessName: 'Demo Laundromat', salesTaxRate: 0, email: 'provider@example.com',
  });
  await db.doc('users/+14025550000').set({
    phoneNumber: '+14025550000', name: 'Demo Customer', zipCode: '11743', email: 'customer@example.com',
  });
  await db.doc('orders/order_demo').set({
    id: 'order_demo', customerPhone: '+14025550000', customerName: 'Demo Customer', status: 'requested',
    providerId: 'broadcast', zipCode: '11743', logisticsType: 'dropoff',
    estimatedPrice: 50, orderSubtotal: 40, createdAt: new Date().toISOString(),
  });
  console.log('Seeded emulator: apiConfig/global, providers/14025551111_11743, users/+14025550000, orders/order_demo');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
