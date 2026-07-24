// One-time backfill for the stats/platformCounts aggregate that the admin console
// reads (order buckets, user/provider totals, pending-license queue). The Cloud
// Function triggers keep this doc current going forward; this script seeds it from
// the existing data so the counts are correct immediately after deploy rather than
// only reflecting activity that happens post-deploy.
//
// Idempotent: it recomputes the full counts and OVERWRITES the doc, so it can be
// re-run any time to reconcile drift from at-least-once trigger retries.
//
// Run against PRODUCTION (uses application-default creds / GOOGLE_APPLICATION_CREDENTIALS):
//   GCLOUD_PROJECT=<your-project> node scripts/backfill-platform-counts.js
// Or against the emulator:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo-foodyzz \
//     node scripts/backfill-platform-counts.js
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const db = admin.firestore();

const isLicensePending = (u) => !!(u && u.driverLicense && u.driverLicense.frontPath && !u.driverLicense.reviewedAt);

(async () => {
  // Orders: total + per-status buckets.
  const ordersByStatus = {};
  let ordersTotal = 0;
  const ordersSnap = await db.collection('orders').get();
  ordersSnap.forEach((d) => {
    ordersTotal += 1;
    const s = d.data().status || 'unknown';
    ordersByStatus[s] = (ordersByStatus[s] || 0) + 1;
  });

  // Users: total + pending-license queue.
  let usersTotal = 0;
  let pendingLicenses = 0;
  const usersSnap = await db.collection('users').get();
  usersSnap.forEach((d) => {
    usersTotal += 1;
    if (isLicensePending(d.data())) pendingLicenses += 1;
  });

  // Providers: total.
  const providersSnap = await db.collection('providers').get();
  const providersTotal = providersSnap.size;

  const counts = {
    ordersTotal,
    ordersByStatus,
    usersTotal,
    providersTotal,
    pendingLicenses,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    backfilledAt: new Date().toISOString(),
  };

  await db.doc('stats/platformCounts').set(counts, { merge: true });
  // eslint-disable-next-line no-console
  console.log('platformCounts backfilled:', JSON.stringify({ ordersTotal, ordersByStatus, usersTotal, providersTotal, pendingLicenses }, null, 2));
  process.exit(0);
})().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('backfill failed:', e);
  process.exit(1);
});
