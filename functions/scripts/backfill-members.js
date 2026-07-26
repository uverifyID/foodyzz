// One-off backfill: record every EXISTING store's creator as its first member.
//
// Access to a store used to be "the phone in the doc id is mine"
// (firestore.rules ownsPhoneField). It is now "providers/{id}/members/{E164phone}
// exists". Stores created before that change have no member docs at all, so
// without this pass their owners keep write access only through the ownsPhoneField
// clause — and would never appear in the app's membership-driven store switcher.
//
// RUN THIS BEFORE (or immediately after) deploying the new rules and app build.
// Idempotent: re-running only re-writes the same owner docs.
//
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/backfill-members.js --dry-run
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/backfill-members.js
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const db = admin.firestore();

const dryRun = process.argv.includes('--dry-run');

(async () => {
  const snap = await db.collection('providers').get();
  if (snap.empty) {
    console.log('No provider stores to backfill.');
    process.exit(0);
  }

  let created = 0;
  let skipped = 0;
  let unusable = 0;
  // Batched at 400 (well under the 500-op cap) so a large fleet is one pass, not
  // one round-trip per store.
  let batch = db.batch();
  let pending = 0;

  for (const doc of snap.docs) {
    const data = doc.data() || {};
    // Fall back to the doc-id prefix: a legacy doc may have no phoneNumber field,
    // and its owner would otherwise be left with no member record at all.
    const digits = String(data.phoneNumber || doc.id.split('_')[0] || '').replace(/\D/g, '');
    if (digits.length < 8) {
      console.warn(`  ! ${doc.id} — no usable phone; SKIPPED (nobody will be able to write to it)`);
      unusable++;
      continue;
    }
    const phone = `+${digits}`;
    const memberRef = doc.ref.collection('members').doc(phone);

    if ((await memberRef.get()).exists) { skipped++; continue; }
    created++;
    if (dryRun) {
      console.log(`  [dry-run] would add ${phone} as owner of ${doc.id}`);
      continue;
    }

    batch.set(memberRef, {
      phone,
      role: 'owner',
      ...(data.businessName ? { name: String(data.businessName) } : {}),
      addedAt: new Date().toISOString(),
    }, { merge: true });
    if (++pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (!dryRun && pending > 0) await batch.commit();

  console.log('');
  console.log(`  stores scanned:   ${snap.size}`);
  console.log(`  owners ${dryRun ? 'to add' : 'added'}:    ${created}`);
  console.log(`  already present:  ${skipped}`);
  if (unusable) console.log(`  UNUSABLE:         ${unusable}  ← no phone on the doc or its id`);
  console.log('');
  process.exit(0);
})().catch((e) => {
  console.error('failed:', e && (e.message || e));
  process.exit(1);
});
