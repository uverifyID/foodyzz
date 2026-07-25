// Enables TOTP (authenticator-app) multi-factor auth on the project.
//
// The Firebase console only surfaces SMS MFA; TOTP is set on the Identity Platform
// project config. This script reads the current MFA config, ADDS a TOTP provider
// (preserving any existing SMS/phone factor), and writes it back. Idempotent — safe
// to re-run; it won't duplicate the TOTP provider or disable SMS.
//
// Does NOT affect the mobile-app customers: enabling TOTP only makes it AVAILABLE
// for enrollment. Only accounts that actually enroll a factor (your admin) are ever
// challenged. Phone/SMS primary sign-in is unchanged.
//
// Run with admin credentials:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enable-totp-mfa.js
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'foodyzz-27b3e' });

(async () => {
  const pcm = admin.auth().projectConfigManager();

  const current = await pcm.getProjectConfig();
  const mfc = current.multiFactorConfig || {};
  console.log('BEFORE — multiFactorConfig:\n', JSON.stringify(mfc, null, 2));

  // Keep every existing provider except a prior TOTP one (we re-add it ENABLED).
  const providerConfigs = (mfc.providerConfigs || []).filter((p) => !p.totpProviderConfig);
  providerConfigs.push({
    state: 'ENABLED',
    // adjacentIntervals: accept codes from N steps before/after (clock drift).
    totpProviderConfig: { adjacentIntervals: 5 },
  });

  const updated = await pcm.updateProjectConfig({
    multiFactorConfig: {
      state: mfc.state || 'ENABLED',
      factorIds: mfc.factorIds || [], // preserves SMS (['phone']) if it was set
      providerConfigs,
    },
  });

  console.log('\nAFTER — multiFactorConfig:\n', JSON.stringify(updated.multiFactorConfig, null, 2));
  console.log('\n✔ TOTP multi-factor auth is now enabled. Reload the admin console and log in to enroll.');
  process.exit(0);
})().catch((e) => {
  console.error('failed to enable TOTP MFA:', e && (e.message || e));
  process.exit(1);
});
