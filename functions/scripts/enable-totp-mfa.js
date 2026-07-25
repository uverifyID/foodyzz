// Configures TOTP-only multi-factor auth on the project: enables TOTP
// (authenticator app) and DISABLES SMS MFA — the setup Foodyzz uses (a single
// admin on TOTP; nothing uses SMS as a second factor).
//
// The Firebase console only surfaces SMS MFA; TOTP is set on the Identity Platform
// project config, which is why this runs via the Admin SDK. Idempotent — safe to
// re-run.
//
// SAFE for the mobile apps: this changes the SECOND-FACTOR config only. It does NOT
// touch the "Phone" SIGN-IN provider your customers use to log in (that's primary
// auth, a different setting). Only accounts that enroll a factor (your admin) are
// ever challenged.
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

  const updated = await pcm.updateProjectConfig({
    multiFactorConfig: {
      state: 'ENABLED',
      factorIds: [],                 // [] disables SMS second-factor (not phone sign-in)
      providerConfigs: [
        {
          state: 'ENABLED',
          // adjacentIntervals: accept codes N steps before/after (clock drift).
          totpProviderConfig: { adjacentIntervals: 5 },
        },
      ],
    },
  });

  console.log('\nAFTER — multiFactorConfig:\n', JSON.stringify(updated.multiFactorConfig, null, 2));
  console.log('\n✔ TOTP enabled, SMS MFA disabled. Reload the admin console and log in to enroll.');
  process.exit(0);
})().catch((e) => {
  console.error('failed to configure TOTP MFA:', e && (e.message || e));
  process.exit(1);
});
