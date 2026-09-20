// One-time: customers whose licence and proof of address staff ALREADY approved
// under the manual process, before customer verification shipped, get those
// approvals recorded in customerKyc — identity verified, and the address verified
// for their current delivery address. Going forward syncDocumentReviews does this
// on every staff decision; this covers the approvals that happened before it.
// Location is not backfilled: those customers still do the GPS check (or staff
// override it).
//
// Dry run by default. Sends no email or push (the hooks are not installed).
// Run `npm run build` first — it uses the compiled lib/.
//
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/backfill-verification-from-documents.js
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/backfill-verification-from-documents.js --apply
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const { syncDocumentReviews } = require('../lib/customerVerification');
const apply = process.argv.includes('--apply');

(async () => {
  const snap = await admin.firestore().collection('users').where('onboarded', '==', true).get();
  let eligible = 0;
  for (const d of snap.docs) {
    const u = d.data();
    const lic = u.driverLicense;
    const poa = u.addressProof;
    if (!lic?.frontPath || !lic?.backPath || !lic?.reviewedAt || !poa?.frontPath || !poa?.reviewedAt) continue;
    eligible++;
    console.log(`${apply ? 'recording' : 'would record'} ${d.id} (${u.name || '—'}) — licence reviewed ${lic.reviewedAt} by ${lic.reviewedBy || '?'}`);
    // before = {} makes both approvals read as new.
    if (apply) await syncDocumentReviews(d.id, {}, u);
  }
  console.log(`\n${eligible} of ${snap.size} onboarded customers have staff-approved documents.${apply ? '' : ' Dry run — pass --apply to record them.'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
