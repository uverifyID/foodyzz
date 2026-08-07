// Seeds `apiConfig/logistics` — the single document that holds every table from the
// Foodyzz appendix (bike models + rates, inventory counts, fees, delivery window) —
// and materializes the individual `bikes` docs implied by the inventory counts.
//
// Against the emulator:
//   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=foodyzz-27b3e \
//     node scripts/seed-logistics.js
//
// Against the real foodyzz-27b3e project (careful — writes live data):
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json node scripts/seed-logistics.js --prod
//
// Re-running is safe: the config doc is merged, and a bike doc is only created if a
// bike with that number doesn't already exist (so rental history is never clobbered).
const admin = require('firebase-admin');

const isProd = process.argv.includes('--prod');
if (!isProd && !process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST is not set — start the emulator first, or pass --prod.');
  process.exit(1);
}

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'foodyzz-27b3e' });
const db = admin.firestore();

// ---------------------------------------------------------------------------
// Appendix: bike rate model. Rent is quoted per WEEK, Rent-to-Buy per MONTH, Buy
// is a one-time price with no commitment. `imageUrl` is blank until the operator
// uploads model photos (admin hub → Global Config → Logistics).
// ---------------------------------------------------------------------------
const BIKE_MODELS = [
  {
    model: 1,
    name: 'Foodyzz Model 1',
    imageUrl: '',
    // The rent rate carries the damage/theft waiver inside it — there is deliberately no
    // separate protection fee, so nothing on a bill is priced against the waiver. The
    // base rate bills per week while the fee bundle bills once per rental, so a fee
    // folded into the rate must be spread across the minimum term, not simply added.
    rates: { rent: 22.49, buy: 899, rentToBuy: 69.99 },
    // Minimum commitment the customer must sign up for, in the unit below.
    minCommitment: { rent: 4, rentToBuy: 12, rentCadence: 'weekly', rentToBuyCadence: 'monthly' },
    // NYC Admin Code § 20-610 covers renting and leasing, not just selling: the listing
    // must name the accredited laboratory that certified the device and its battery.
    certification: {
      deviceStandard: 'UL 2849',
      batteryStandard: 'UL 2271',
      lab: 'TÜV Rheinland',
      deviceCertificateNumber: 'CU 726061660001',
      batteryCertificateNumber: 'CU 72303450 0003',
      verifyUrl: 'https://www.certipedia.com',
      deviceClass: 'Class 2',
      maxSpeedMph: 15,
    },
  },
];

// Duration unit per rental type — rent is billed in weeks, rent-to-buy in months.
const DURATION_UNITS = { rent: 'weeks', rentToBuy: 'months' };

// Appendix: bike inventory. These are the starting counts; the `bikes` collection
// below is the live source of truth once bikes start moving.
const INVENTORY = {
  1: { new: 10, used: 5 },
};

// Appendix: fees. `required: true` fees cannot be opted out of by the customer.
// The deposit is special-cased everywhere: it is NEVER part of the rental invoice —
// it is secured separately against a saved card (see functions setupDepositMandate).
const FEES = [
  { key: 'deposit', label: 'Deposit', amount: 100, required: true, cadence: 'once', isDeposit: true },
  { key: 'maintenance', label: 'Maintenance', amount: 5.99, required: true, cadence: 'weekly' },
  { key: 'gpsTracker', label: 'GPS tracker', amount: 4.99, required: false, cadence: 'weekly' },
];

// Appendix: delivery time window (5pm–9pm), sliced into hourly selectable slots.
const DELIVERY = { startTime: '17:00', endTime: '21:00', slotMinutes: 60 };

// Days after a bike's expected end date before it can be re-rented — used to quote
// an "expected availability" date when a model is fully rented out.
const RESTOCK_DAYS = 2;

// Flat admin fee charged when staff make the trip to collect a bike and the customer
// isn't there. Billed on top of the renewed rental term (the bike stays out, so the
// rental continues for another term at the price they already pay).
const PICKUP_FEE = 25;

// Bike numbers start here and increment; matches the appendix example (1001).
const BIKE_NO_START = 1001;

(async () => {
  await db.doc('apiConfig/logistics').set(
    {
      bikeModels: BIKE_MODELS,
      durationUnits: DURATION_UNITS,
      inventory: INVENTORY,
      fees: FEES,
      delivery: DELIVERY,
      restockDays: RESTOCK_DAYS,
      pickupFee: PICKUP_FEE,
      updatedAt: new Date().toISOString(),
    },
    { merge: true },
  );
  console.log('Seeded apiConfig/logistics');

  // Materialize one doc per physical bike so availability, rental history and the
  // "next available date" quote can all be answered from a single query.
  let bikeNo = BIKE_NO_START;
  let created = 0;
  for (const [model, counts] of Object.entries(INVENTORY)) {
    for (const condition of ['new', 'used']) {
      for (let i = 0; i < counts[condition]; i++) {
        const id = `bike_${bikeNo}`;
        const ref = db.doc(`bikes/${id}`);
        const snap = await ref.get();
        if (!snap.exists) {
          await ref.set({
            id,
            model: Number(model),
            bikeNo,
            condition,               // 'new' | 'used'
            status: 'available',     // 'available' | 'reserved' | 'rented' | 'sold' | 'maintenance'
            rentedBy: null,
            rentedDate: null,
            rentalDuration: null,
            expectedEndDate: null,
            createdAt: new Date().toISOString(),
          });
          created++;
        }
        bikeNo++;
      }
    }
  }
  console.log(`Seeded bikes: ${created} created, ${bikeNo - BIKE_NO_START - created} already existed`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
