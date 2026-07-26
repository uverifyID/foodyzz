// Store membership management — lets ONE FoodyzzHQ store be run by SEVERAL people.
//
// A store is `providers/{phone}_{identifier}` and its doc id names whoever created
// it. That id used to BE the access check (firestore.rules ownsPhoneField), so a
// store could only ever have one user: a second staff member signing in with their
// own number silently landed on a different, empty store. Access is now
// `providers/{providerId}/members/{E164phone}` existing.
//
// Members are written only by Cloud Functions — rules deny client writes, since a
// self-writable member doc would let anyone join any store. Joining therefore needs
// a single-use invite, issued here for ONE specific phone and redeemed by
// redeemHqInvite after that phone passes SMS verification.
//
// The CODE is the credential: `invites` is deny-all to every client, and the code
// is checked server-side only. It is bound to a phone at issue time, so a leaked
// code is useless to anybody else.
//
// Run against PRODUCTION (uses application-default creds / GOOGLE_APPLICATION_CREDENTIALS):
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js --stores
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js +14025551234 --store 14026061003_68022 --name "Sam"
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js --list
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js --members 14026061003_68022
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js --revoke A7K2M9QP
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/invite-member.js --remove 14026061003_68022 +14025551234
//
// Unlike enroll-staff.js this does NOT require the invitee to have a Firebase Auth
// account already — inviting someone who has never opened the app is the point.
const crypto = require('crypto');
const admin = require('firebase-admin');

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
const db = admin.firestore();

const args = process.argv.slice(2);
// Flags that consume the next argument. Listing them explicitly is what keeps
// `--dry-run +14025551234` from swallowing the phone number as a flag value.
const VALUE_FLAGS = new Set(['--store', '--name', '--expires', '--members', '--revoke']);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const positionals = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && VALUE_FLAGS.has(args[i - 1])),
);

// Must match INVITE_ALPHABET / INVITE_CODE_LENGTH in functions/src/index.ts.
// No 0/O/1/I — those are misread whenever a code is read out or handwritten.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;
const DEFAULT_TTL_DAYS = 14;

// providers.phoneNumber is digits-only; every member/invite key is E.164.
const toE164 = (raw) => {
  const digits = String(raw || '').replace(/\D/g, '');
  return digits.length >= 8 ? `+${digits}` : null;
};

// crypto.randomInt, not Math.random: the code is a credential, and a predictable
// PRNG would make the ~1e12 keyspace meaningless.
const generateCode = () => Array.from(
  { length: CODE_LENGTH },
  () => ALPHABET[crypto.randomInt(ALPHABET.length)],
).join('');

const parseTtlDays = (raw) => {
  if (!raw) return DEFAULT_TTL_DAYS;
  const m = String(raw).match(/^(\d+)\s*d?$/i);
  return m ? Math.max(1, Math.min(365, parseInt(m[1], 10))) : DEFAULT_TTL_DAYS;
};

const listStores = async () => {
  const snap = await db.collection('providers').get();
  if (snap.empty) {
    console.log('No provider stores exist yet.');
    return;
  }
  console.log(`provider stores (${snap.size}):`);
  for (const d of snap.docs) {
    const v = d.data() || {};
    const members = await d.ref.collection('members').get();
    const state = v.onboarded ? 'live' : 'setup';
    console.log(`  ${d.id.padEnd(24)} ${state.padEnd(6)} ${String(members.size).padStart(2)} member(s)  ${v.businessName || '—'}`);
  }
};

const listMembers = async (providerId) => {
  const provider = await db.collection('providers').doc(providerId).get();
  if (!provider.exists) {
    console.error(`No such store: providers/${providerId}`);
    process.exit(1);
  }
  const snap = await db.collection('providers').doc(providerId).collection('members').get();
  console.log(`\n${providerId} — ${provider.data().businessName || 'Unnamed'} (${snap.size} member(s))`);
  if (snap.empty) {
    console.log('  NO MEMBERS — nobody can write to this store.');
    console.log('  Run scripts/backfill-members.js to record existing owners.');
    return;
  }
  snap.forEach((d) => {
    const v = d.data() || {};
    console.log(`  ${d.id.padEnd(16)} ${String(v.role || 'staff').padEnd(6)} ${v.name || ''}`);
  });
};

const listInvites = async () => {
  const storeFilter = valueOf('--store');
  let q = db.collection('invites');
  if (storeFilter) q = q.where('providerId', '==', storeFilter);
  const snap = await q.get();
  if (snap.empty) {
    console.log('No invites outstanding.');
    return;
  }
  console.log(`invites (${snap.size}):`);
  const now = Date.now();
  snap.forEach((d) => {
    const v = d.data() || {};
    const state = v.used ? 'USED' : v.revokedAt ? 'REVOKED' :
      Date.parse(v.expiresAt) <= now ? 'EXPIRED' : 'open';
    console.log(`  ${d.id}  ${state.padEnd(8)} ${String(v.phone).padEnd(16)} ${v.providerId}  ${v.name || ''}`);
  });
};

const issue = async (rawPhone) => {
  const phone = toE164(rawPhone);
  if (!phone) {
    console.error(`"${rawPhone}" is not a phone number.`);
    process.exit(1);
  }
  const providerId = valueOf('--store');
  if (!providerId) {
    console.error('A store is required: --store <providerId>   (see --stores)');
    process.exit(1);
  }
  const provider = await db.collection('providers').doc(providerId).get();
  if (!provider.exists) {
    console.error(`No such store: providers/${providerId}`);
    process.exit(1);
  }

  // Already in? Issuing a second code would just be a confusing no-op for them.
  const existing = await db.collection('providers').doc(providerId).collection('members').doc(phone).get();
  if (existing.exists) {
    console.log(`${phone} is ALREADY a member of ${providerId} (${existing.data().role}). No invite issued.`);
    return;
  }

  const name = valueOf('--name');
  const ttlDays = parseTtlDays(valueOf('--expires'));
  const code = generateCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  if (has('--dry-run')) {
    console.log(`[dry-run] would invite ${phone} to ${providerId} (expires in ${ttlDays}d)`);
    return;
  }

  // create(), not set(): a collision on the 1.1e12 keyspace is vanishingly
  // unlikely, but silently overwriting a live invite would revoke someone's access.
  await db.collection('invites').doc(code).create({
    phone,
    providerId,
    role: 'staff',
    ...(name ? { name } : {}),
    used: false,
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    createdBy: process.env.FOODYZZ_ADMIN_PHONE || 'script',
  });

  console.log('');
  console.log(`  Invite code:  ${code}`);
  console.log(`  For:          ${phone}${name ? ` (${name})` : ''}`);
  console.log(`  Store:        ${providerId} — ${provider.data().businessName || 'Unnamed'}`);
  console.log(`  Expires:      ${expiresAt.toISOString().slice(0, 10)} (${ttlDays} days)`);
  console.log('');
  console.log('  They enter their phone number AND this code on the FoodyzzHQ sign-in');
  console.log('  screen. Single use, and only from that phone number.');
  console.log('');
};

const revoke = async (code) => {
  const ref = db.collection('invites').doc(String(code).trim().toUpperCase());
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`No such invite: ${code}`);
    process.exit(1);
  }
  if (snap.data().used) {
    console.log(`${code} was already redeemed — revoking it does NOT remove the member.`);
    console.log(`Use --remove ${snap.data().providerId} ${snap.data().phone} for that.`);
  }
  // Flagged, not deleted: a withdrawn code stays visible in --list as a record of
  // who was invited and never joined.
  await ref.set({ revokedAt: new Date().toISOString() }, { merge: true });
  console.log(`revoked ${code}`);
};

const remove = async (providerId, rawPhone) => {
  const phone = toE164(rawPhone);
  if (!providerId || !phone) {
    console.error('Usage: node scripts/invite-member.js --remove <providerId> +14025551234');
    process.exit(1);
  }
  const ref = db.collection('providers').doc(providerId).collection('members').doc(phone);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`${phone} is not a member of ${providerId}.`);
    process.exit(1);
  }
  if (snap.data().role === 'owner' && !has('--force')) {
    console.error(`${phone} is the OWNER of ${providerId}. Removing them locks the store's creator out.`);
    console.error('Re-run with --force if that is really intended.');
    process.exit(1);
  }
  await ref.delete();
  console.log(`removed ${phone} from ${providerId}`);
  console.log('Their device keeps working until its ID token is re-evaluated — they lose');
  console.log('write access on the next Firestore write, and the store on next sign-in.');
};

(async () => {
  if (has('--stores')) { await listStores(); process.exit(0); }
  if (has('--list')) { await listInvites(); process.exit(0); }

  if (has('--members')) {
    const providerId = valueOf('--members');
    if (!providerId) {
      console.error('Usage: node scripts/invite-member.js --members <providerId>');
      process.exit(1);
    }
    await listMembers(providerId);
    console.log('');
    process.exit(0);
  }

  if (has('--revoke')) {
    const code = valueOf('--revoke');
    if (!code) {
      console.error('Usage: node scripts/invite-member.js --revoke <CODE>');
      process.exit(1);
    }
    await revoke(code);
    process.exit(0);
  }

  if (has('--remove')) {
    const i = args.indexOf('--remove');
    await remove(args[i + 1], args[i + 2]);
    process.exit(0);
  }

  if (positionals.length === 1) {
    await issue(positionals[0]);
    process.exit(0);
  }

  console.error('Usage:');
  console.error('  node scripts/invite-member.js --stores');
  console.error('  node scripts/invite-member.js +14025551234 --store <providerId> [--name "Sam"] [--expires 7d] [--dry-run]');
  console.error('  node scripts/invite-member.js --list [--store <providerId>]');
  console.error('  node scripts/invite-member.js --members <providerId>');
  console.error('  node scripts/invite-member.js --revoke <CODE>');
  console.error('  node scripts/invite-member.js --remove <providerId> +14025551234 [--force]');
  process.exit(1);
})().catch((e) => {
  console.error('failed:', e && (e.message || e));
  process.exit(1);
});
