// Stores the Didit.me (customer identity verification) credentials at
// apiConfigSecret/didit — server-only (firestore.rules default deny), next to
// apiConfigSecret/stripe and apiConfigSecret/smtp. Read by src/didit.ts.
//
// Values come from the environment, or are prompted for with echo off so they
// never land in shell history. Blank keeps what is stored (merge write).
//
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/set-didit-secret.js
//   GCLOUD_PROJECT=foodyzz-27b3e DIDIT_API_KEY=... DIDIT_WEBHOOK_SECRET=... \
//     DIDIT_WORKFLOW_ID=... DIDIT_ORGANIZATION_ID=... node scripts/set-didit-secret.js
//
// --copy-ipgeolocation-from=<project> also copies apiConfigSecret/ipgeolocation
// (the IP-location key src/ipLocation.ts uses) from another Firebase project —
// e.g. uhplus-15c36, where the Suds backend keeps the same key.
const admin = require('firebase-admin');
const readline = require('readline');

const PROJECT = process.env.GCLOUD_PROJECT;
if (!PROJECT) { console.error('Set GCLOUD_PROJECT (foodyzz-27b3e for production).'); process.exit(1); }

function ask(question, hidden) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.startsWith(question)) rl.output.write(s); };
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
  });
}
const value = async (env, question, hidden) => process.env[env] ?? (process.stdin.isTTY ? ask(question, hidden) : '');

(async () => {
  const app = admin.initializeApp({ projectId: PROJECT });
  const ref = app.firestore().doc('apiConfigSecret/didit');

  const apiKey = await value('DIDIT_API_KEY', 'Didit API key (hidden, blank keeps): ', true);
  const webhookSecret = await value('DIDIT_WEBHOOK_SECRET', 'Didit webhook secret (hidden, blank keeps): ', true);
  const workflowId = await value('DIDIT_WORKFLOW_ID', 'Didit workflow id (blank keeps): ', false);
  const organizationId = await value('DIDIT_ORGANIZATION_ID', 'Didit organization id (blank keeps): ', false);
  if (workflowId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workflowId)) {
    console.error('The workflow id must be a UUID — run scripts/didit-workflows.js to list them.');
    process.exit(1);
  }

  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  if (apiKey) update.apiKey = apiKey;
  if (webhookSecret) update.webhookSecret = webhookSecret;
  if (workflowId) update.workflowId = workflowId;
  if (organizationId) update.organizationId = organizationId;
  await ref.set(update, { merge: true });
  const stored = Object.keys((await ref.get()).data() || {}).filter((k) => k !== 'updatedAt').sort();
  console.log(`apiConfigSecret/didit on ${PROJECT} now has: ${stored.join(', ')}`);

  const from = (process.argv.find((a) => a.startsWith('--copy-ipgeolocation-from=')) || '').split('=')[1];
  if (from) {
    const src = admin.initializeApp({ projectId: from }, 'source');
    const key = String((await src.firestore().doc('apiConfigSecret/ipgeolocation').get()).data()?.apiKey || '').trim();
    if (!key) {
      console.log(`${from} has no apiConfigSecret/ipgeolocation.apiKey — IP lookups use the keyless freeipapi fallback.`);
    } else {
      await app.firestore().doc('apiConfigSecret/ipgeolocation')
        .set({ apiKey: key, copiedFrom: from, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      console.log(`Copied apiConfigSecret/ipgeolocation.apiKey from ${from} to ${PROJECT}.`);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
