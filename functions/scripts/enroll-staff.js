// Staff allowlist management — grants (or revokes) the `admin` custom claim that
// gates customer identity documents in storage.rules and isAdmin() in
// firestore.rules.
//
// The allowlist lives at `staff/{E164phone}`. It is deny-all to every client
// (firestore.rules), so it can only be written with admin credentials — which is
// the point: a client-writable allowlist would be self-grant, and the claim reads
// every customer's driver licence. The claim itself is applied by the
// syncAdminClaim callable, which the FoodyzzHQ app runs on every sign-in; this
// script only maintains the list it reads.
//
// ⚠️ Both apps share ONE Firebase Auth pool and both sign in by phone, so "every
// phone account" is NOT "every FoodyzzHQ user" — it includes every foodyzz
// CUSTOMER. Granting those the claim would let any customer read every other
// customer's ID. `--all` therefore enumerates the `providers` collection (a doc is
// created there at FoodyzzHQ sign-in) and never Firebase Auth's user list.
//
// Every phone is verified against Firebase Auth before it is written, so the doc id
// is guaranteed to match the `phone_number` claim syncAdminClaim looks up — a
// mismatched key silently grants nothing.
//
// Run against PRODUCTION (uses application-default creds / GOOGLE_APPLICATION_CREDENTIALS):
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enroll-staff.js --list
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enroll-staff.js --all --dry-run
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enroll-staff.js --all
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enroll-staff.js +14026061003
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/enroll-staff.js --revoke +14026061003
//
// Enrolled staff must SIGN OUT and back in to FoodyzzHQ (or hit "tap to retry" on a
// document tile) before the claim reaches their device — Firebase embeds claims at
// token issue time, so an already-issued token keeps working without it.
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const db = admin.firestore();

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const dryRun = has('--dry-run');
const phoneArgs = args.filter((a) => !a.startsWith('--'));

// providers.phoneNumber is stored DIGITS-ONLY ("14026061003"); the auth claim — and
// therefore the staff doc id — is E.164 ("+14026061003").
const toE164 = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits ? `+${digits}` : null;
};

// The doc id must equal request.auth.token.phone_number exactly, so resolve it from
// Firebase Auth rather than trusting the stored digits (a legacy provider doc could
// be missing a country code, which would key the allowlist to a number that never
// signs in).
const resolveAuthPhone = async (e164) => {
  try {
    const user = await admin.auth().getUserByPhoneNumber(e164);
    return user.phoneNumber;
  } catch (e) {
    if (e && e.code === 'auth/user-not-found') return null;
    throw e;
  }
};

const list = async () => {
  const snap = await db.collection('staff').get();
  if (snap.empty) {
    console.log('staff allowlist is EMPTY — nobody has the admin claim via this path.');
    return;
  }
  console.log(`staff allowlist (${snap.size}):`);
  snap.forEach((d) => {
    const v = d.data() || {};
    const state = v.active === false ? 'REVOKED' : 'active';
    console.log(`  ${d.id.padEnd(16)} ${state.padEnd(8)} ${v.name || ''}`);
  });
};

const enroll = async (entries) => {
  if (entries.length === 0) {
    console.log('Nothing to enrol.');
    return;
  }
  console.log(`${dryRun ? '[dry-run] would enrol' : 'Enrolling'} ${entries.length} account(s):`);
  for (const { phone, name } of entries) {
    console.log(`  ${phone}${name ? `  (${name})` : ''}`);
    if (dryRun) continue;
    await db.collection('staff').doc(phone).set({
      ...(name ? { name } : {}),
      active: true,
      addedAt: new Date().toISOString(),
    }, { merge: true });
  }
  if (!dryRun) {
    console.log('\nDone. Each person must sign out and back in to FoodyzzHQ to pick up the claim.');
    console.log('Verify with: firebase functions:log --only syncAdminClaim');
  }
};

(async () => {
  if (has('--list')) { await list(); process.exit(0); }

  if (has('--revoke')) {
    if (phoneArgs.length === 0) {
      console.error('Usage: node scripts/enroll-staff.js --revoke +14026061003');
      process.exit(1);
    }
    for (const raw of phoneArgs) {
      const phone = toE164(raw);
      // Flag rather than delete: syncAdminClaim treats active:false as "not staff"
      // and revokes on next sign-in, and the row stays visible in --list as an
      // audit trail of who once had access.
      await db.collection('staff').doc(phone).set(
        { active: false, revokedAt: new Date().toISOString() }, { merge: true });
      console.log(`revoked ${phone} — claim drops on their next sign-in`);
    }
    process.exit(0);
  }

  // Explicit phone numbers.
  if (phoneArgs.length > 0) {
    const entries = [];
    for (const raw of phoneArgs) {
      const e164 = toE164(raw);
      if (!e164) { console.warn(`  skipped "${raw}" — not a phone number`); continue; }
      const authPhone = await resolveAuthPhone(e164);
      if (!authPhone) {
        console.warn(`  skipped ${e164} — no Firebase Auth account with that number ` +
                     '(they must sign in to FoodyzzHQ at least once first)');
        continue;
      }
      entries.push({ phone: authPhone });
    }
    await enroll(entries);
    process.exit(0);
  }

  if (!has('--all')) {
    console.error('Usage:');
    console.error('  node scripts/enroll-staff.js --list');
    console.error('  node scripts/enroll-staff.js --all [--dry-run]');
    console.error('  node scripts/enroll-staff.js +14026061003 [+1555...]');
    console.error('  node scripts/enroll-staff.js --revoke +14026061003');
    process.exit(1);
  }

  // --all: every account that has ever signed in to FoodyzzHQ. One provider doc per
  // store (`${phone}_${zip}`), so one owner with several stores appears repeatedly —
  // dedupe by phone.
  const snap = await db.collection('providers').get();
  const byPhone = new Map();
  snap.forEach((d) => {
    const data = d.data() || {};
    const e164 = toE164(data.phoneNumber || d.id.split('_')[0]);
    if (!e164) return;
    if (!byPhone.has(e164) || (!byPhone.get(e164) && data.businessName)) {
      byPhone.set(e164, data.businessName || null);
    }
  });
  console.log(`Found ${snap.size} provider store doc(s) → ${byPhone.size} distinct phone number(s).`);

  const entries = [];
  for (const [e164, name] of byPhone) {
    const authPhone = await resolveAuthPhone(e164);
    if (!authPhone) {
      console.warn(`  skipped ${e164} — no Firebase Auth account (stale provider doc?)`);
      continue;
    }
    entries.push({ phone: authPhone, name });
  }
  await enroll(entries);
  process.exit(0);
})().catch((e) => {
  console.error('failed:', e && (e.message || e));
  process.exit(1);
});
