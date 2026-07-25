// Marks an admin account's email as verified, so it can enroll TOTP 2FA.
// Firebase blocks second-factor enrollment on unverified emails
// (auth/unverified-email). For the single owner-admin this is the quickest path —
// no verification-email round-trip.
//
// Run with admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/verify-admin-email.js you@foodyzz.com
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'foodyzz-27b3e' });

const email = process.argv[2] || process.env.ADMIN_EMAIL;
if (!email) {
  console.error('Usage: node scripts/verify-admin-email.js <admin-email>');
  process.exit(1);
}

(async () => {
  const user = await admin.auth().getUserByEmail(email);
  if (user.emailVerified) {
    console.log(`${email} (uid ${user.uid}) is already emailVerified — nothing to do.`);
    process.exit(0);
  }
  await admin.auth().updateUser(user.uid, { emailVerified: true });
  console.log(`✔ ${email} (uid ${user.uid}) marked emailVerified.`);
  console.log('  Now SIGN OUT of the admin console and sign back in, then enroll 2FA.');
  process.exit(0);
})().catch((e) => {
  console.error('failed:', e && (e.message || e));
  process.exit(1);
});
