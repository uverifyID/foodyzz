// Lists the Didit workflows on the account whose key is stored at
// apiConfigSecret/didit, with the workflow_id UUID that session creation needs
// (the token in a verify.didit.me/u/<token> share link is NOT it). Never prints
// the key.
//
//   GCLOUD_PROJECT=foodyzz-27b3e node scripts/didit-workflows.js
const admin = require('firebase-admin');

(async () => {
  admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || undefined });
  const cfg = (await admin.firestore().doc('apiConfigSecret/didit').get()).data() || {};
  if (!cfg.apiKey) { console.error('apiConfigSecret/didit has no apiKey — run scripts/set-didit-secret.js first.'); process.exit(1); }
  const res = await fetch('https://verification.didit.me/v3/workflows/', { headers: { 'x-api-key': cfg.apiKey } });
  if (!res.ok) { console.error(`Didit responded ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const body = await res.json();
  const list = Array.isArray(body) ? body : body.results || body.workflows || [];
  console.log(`Stored workflowId: ${cfg.workflowId || '(none)'}\n`);
  for (const w of list) {
    const id = w.workflow_id || w.uuid || w.id;
    const features = w.features ?? w.published_version?.features ?? '';
    console.log(`  ${w.workflow_label || w.label || '(unnamed)'}  ${id}${id === cfg.workflowId ? '   ← stored' : ''}`);
    if (features) console.log(`    ${typeof features === 'string' ? features : JSON.stringify(features)}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
