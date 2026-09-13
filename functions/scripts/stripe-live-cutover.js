// One-time cleanup for switching Stripe from test to live keys.
//
// Everything paid before the switch was paid in Stripe TEST mode, so none of it can
// be captured, refunded or re-charged with the live key. This script:
//   1. Closes every open order created before the cutoff — pre-delivery orders are
//      cancelled; rentals in progress are completed with their rent-to-buy billing
//      stopped (otherwise the hourly installment cron would try to charge test cards
//      with the live key) and their deposit released. Bikes held by those orders go
//      back to available.
//   2. Clears the test-mode Stripe customer + saved card from every user and provider.
//   3. Clears the analytics built from test data: daily stats, the settlements ledger
//      (Analytics tab), provider performance and cancellation counters. Ratings are
//      kept unless --reset-ratings is passed (that also deletes provider reviews).
//   4. Recomputes stats/platformCounts from what remains.
//
// DRY RUN by default — prints what it would change and writes nothing. Take a backup
// first, then re-run with --apply:
//   gcloud firestore export gs://foodyzz-27b3e.firebasestorage.app/backups/pre-live-$(date +%Y%m%d) \
//     --project foodyzz-27b3e --account=rajshrestha@gmail.com
//   GOOGLE_APPLICATION_CREDENTIALS=<sa.json> GCLOUD_PROJECT=foodyzz-27b3e node scripts/stripe-live-cutover.js
//   ... node scripts/stripe-live-cutover.js --apply [--before=2026-09-14T00:00:00Z] [--reset-ratings]
const admin = require('firebase-admin');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RESET_RATINGS = args.includes('--reset-ratings');
const BEFORE = (args.find((a) => a.startsWith('--before=')) || '').slice('--before='.length) || new Date().toISOString();
if (Number.isNaN(Date.parse(BEFORE))) throw new Error(`Invalid --before: ${BEFORE}`);

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const PRE_DELIVERY = ['requested', 'confirmed', 'ready_for_delivery', 'en_route_delivery', 'at_delivery'];
const CLOSED_REASON = 'Closed at the switch to live payments (test-mode payment)';
const BIKE_RENTAL_FIELDS = ['rentedBy', 'rentedByName', 'rentedDate', 'rentalDuration', 'expectedEndDate', 'currentOrderId'];
const BIKE_SALE_FIELDS = ['ownedBy', 'soldAt'];
const STRIPE_USER_FIELDS =['stripeCustomerId', 'billingPaymentMethodId', 'billingCardLast4',
  'billingCardBrand', 'billingCardExpMonth', 'billingCardExpYear'];
const isLicensePending = (u) => !!(u && u.driverLicense && u.driverLicense.frontPath && !u.driverLicense.reviewedAt);
const log = (...a) => console.log(...a); // eslint-disable-line no-console
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function deleteCollection(name) {
  const refs = await db.collection(name).listDocuments();
  if (APPLY && refs.length) {
    const writer = db.bulkWriter();
    for (const ref of refs) writer.delete(ref);
    await writer.close();
  }
  return refs.length;
}

async function closeOrders() {
  const snap = await db.collection('orders').get();
  const now = new Date().toISOString();
  const writer = APPLY ? db.bulkWriter() : null;
  const closed = { cancelled: 0, completed: 0 };
  const stillOpen = new Set(); // real orders placed after the cutoff — never touched

  for (const doc of snap.docs) {
    const o = doc.data();
    if ((o.createdAt || '') >= BEFORE) {
      if (!['cancelled', 'completed'].includes(o.status)) stillOpen.add(doc.id);
      continue;
    }
    const upd = {};
    if (PRE_DELIVERY.includes(o.status)) {
      Object.assign(upd, { status: 'cancelled', expiryReason: CLOSED_REASON });
      closed.cancelled++;
    } else if (o.status === 'delivered') {
      Object.assign(upd, { status: 'completed', completedAt: now, expiryReason: CLOSED_REASON });
      closed.completed++;
    }
    // Also catches a completed/cancelled order whose billing or deposit was left open.
    if (o.billingSchedule && o.billingSchedule.status === 'active') upd['billingSchedule.status'] = 'cancelled';
    if (o.depositStatus === 'secured') Object.assign(upd, { depositStatus: 'released', depositReleasedAt: now });
    if (!Object.keys(upd).length) continue;

    log(`  order ${doc.id} ${o.status} → ${upd.status || o.status}` +
      `${upd['billingSchedule.status'] ? ' · billing stopped' : ''}${upd.depositStatus ? ' · deposit released' : ''}` +
      ` · ${o.customerName || '?'} ${o.customerPhone || ''} · bike ${o.bikeId || '-'} · created ${(o.createdAt || '').slice(0, 10)}`);
    if (writer) writer.update(doc.ref, { ...upd, testModeClosedAt: now, updatedAt: now });
  }
  if (writer) await writer.close();

  // Check in every bike that isn't out on an order still open after this run — the
  // same reset the return check-in does: clear the test customer off it and put a
  // reserved/rented/test-sold bike back in stock. A model no longer offered goes back
  // to maintenance like the rest of its fleet. The list is printed so staff can
  // confirm each bike is physically in the shop.
  const offered = new Set(((await db.doc('apiConfig/logistics').get()).data()?.bikeModels || [])
    .map((m) => String(m.model)));
  let checkedIn = 0;
  const bikes = await db.collection('bikes').get();
  const bikeWriter = APPLY ? db.bulkWriter() : null;
  for (const b of bikes.docs) {
    const bike = b.data();
    if (bike.currentOrderId && stillOpen.has(bike.currentOrderId)) continue;
    if (bike.soldAt && bike.soldAt >= BEFORE) continue; // a real sale after the cutoff
    const patch = {};
    for (const f of BIKE_RENTAL_FIELDS) if (bike[f] != null && bike[f] !== '') patch[f] = null;
    for (const f of BIKE_SALE_FIELDS) if (bike[f] !== undefined) patch[f] = FieldValue.delete();
    if (['reserved', 'rented', 'sold'].includes(bike.status)) {
      patch.status = offered.has(String(bike.model)) ? 'available' : 'maintenance';
    }
    if (!Object.keys(patch).length) continue;
    checkedIn++;
    log(`  bike ${b.id} ${bike.status} → ${patch.status || bike.status}` +
      ` · cleared ${Object.keys(patch).filter((k) => k !== 'status').join(', ') || '-'}`);
    if (bikeWriter) bikeWriter.update(b.ref, patch);
  }
  if (bikeWriter) await bikeWriter.close();
  return { ...closed, checkedIn };
}

// Single-use promo claims made by test orders would stop those customers from ever
// using the code for real.
async function clearPromoRedemptions() {
  const snap = await db.collection('promoRedemptions').get();
  const stale = snap.docs.filter((d) => {
    const at = d.data().claimedAt;
    return !at || (at.toDate ? at.toDate().toISOString() : String(at)) < BEFORE;
  });
  if (APPLY && stale.length) {
    const writer = db.bulkWriter();
    for (const d of stale) writer.delete(d.ref);
    await writer.close();
  }
  return stale.length;
}

async function clearStripeRefs(collection) {
  const snap = await db.collection(collection).get();
  const writer = APPLY ? db.bulkWriter() : null;
  let n = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const present = STRIPE_USER_FIELDS.filter((f) => d[f] !== undefined);
    if (!present.length) continue;
    n++;
    if (writer) writer.update(doc.ref, Object.fromEntries(present.map((f) => [f, FieldValue.delete()])));
  }
  if (writer) await writer.close();
  return n;
}

async function resetProviderAnalytics() {
  const perf = await db.collection('providerPerformance').get();
  const writer = APPLY ? db.bulkWriter() : null;
  let reviews = 0;
  for (const doc of perf.docs) {
    if (!writer) continue;
    if (RESET_RATINGS) {
      writer.delete(doc.ref);
    } else {
      // Keep the rating tallies — they back the stars mirrored onto the provider doc.
      writer.update(doc.ref, { totalRevenue: 0, ordersCompleted: 0, totalAttempts: 0, completionRate: 0,
        updatedAt: FieldValue.serverTimestamp() });
    }
  }
  if (RESET_RATINGS) {
    const providers = await db.collection('providers').get();
    for (const p of providers.docs) {
      const refs = await p.ref.collection('reviews').listDocuments();
      reviews += refs.length;
      if (writer) {
        for (const r of refs) writer.delete(r);
        writer.update(p.ref, { avgRating: FieldValue.delete(), ratedCount: FieldValue.delete() });
      }
    }
  }
  if (writer) await writer.close();
  return { performance: perf.size, reviews };
}

async function recomputePlatformCounts() {
  const ordersByStatus = {};
  let ordersTotal = 0;
  (await db.collection('orders').get()).forEach((d) => {
    ordersTotal++;
    const s = d.data().status || 'unknown';
    ordersByStatus[s] = (ordersByStatus[s] || 0) + 1;
  });
  let usersTotal = 0; let pendingLicenses = 0;
  (await db.collection('users').get()).forEach((d) => { usersTotal++; if (isLicensePending(d.data())) pendingLicenses++; });
  const providersTotal = (await db.collection('providers').count().get()).data().count;
  const counts = { ordersTotal, ordersByStatus, usersTotal, providersTotal, pendingLicenses };
  if (APPLY) {
    await db.doc('stats/platformCounts').set({ ...counts, updatedAt: FieldValue.serverTimestamp(),
      backfilledAt: new Date().toISOString() });
  }
  return counts;
}

(async () => {
  log(`${APPLY ? 'APPLYING' : 'DRY RUN (no writes)'} · project ${process.env.GCLOUD_PROJECT || '(default creds)'} · orders created before ${BEFORE}`);

  log('\n1. Open orders');
  const orders = await closeOrders();
  log(`   → ${orders.cancelled} cancelled, ${orders.completed} completed, ${orders.checkedIn} bike(s) checked in`);

  log('\n2. Test-mode Stripe customers / saved cards, test promo claims');
  log(`   → users: ${await clearStripeRefs('users')}, providers: ${await clearStripeRefs('providers')}, ` +
    `promo redemptions: ${await clearPromoRedemptions()}`);

  // The order updates above fire the stats triggers; let them land before the
  // analytics they write are cleared, so nothing from the cleanup survives.
  if (APPLY && orders.cancelled + orders.completed > 0) { log('\n   waiting 60s for order triggers to settle…'); await sleep(60_000); }

  log('\n3. Analytics');
  log(`   → stats docs: ${await deleteCollection('stats')}, settlements: ${await deleteCollection('settlements')}, ` +
    `providerCancellations: ${await deleteCollection('providerCancellations')}`);
  const perf = await resetProviderAnalytics();
  log(`   → providerPerformance: ${perf.performance} ${RESET_RATINGS ? 'deleted' : 'reset (ratings kept)'}` +
    `${RESET_RATINGS ? `, provider reviews deleted: ${perf.reviews}` : ''}`);

  log('\n4. stats/platformCounts');
  log(`   → ${JSON.stringify(await recomputePlatformCounts())}`);

  log(APPLY ? '\nDone.' : '\nDry run only. Re-run with --apply to make these changes.');
  process.exit(0);
})().catch((e) => { console.error('cutover failed:', e); process.exit(1); }); // eslint-disable-line no-console
