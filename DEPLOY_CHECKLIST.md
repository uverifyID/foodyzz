# Foodyzz — Deploy Checklist

One-shot, ordered runbook for shipping the changes from the production-readiness pass.
Firebase project: **`foodyzz-27b3e`**. Work top to bottom — the **order matters** (two
steps will break payments or counts if done out of sequence).

> Legend: 🔴 = blocker, do not skip · ✅ = verify gate · ⚙️ = command

---

## Phase 0 — Local verification (before touching prod)

- [ ] ⚙️ Functions type-check + full test suite on the emulator
  ```bash
  cd functions
  npm run build           # tsc — must be clean
  npm test                # 5 suites green (live-Stripe tests skip without STRIPE_TEST_KEY)
  ```
- [ ] ⚙️ (optional) Quick smoke only: `npm run qa`  ·  or the full gate: `./scripts/run-qa.sh --full`
- [ ] ⚙️ Type-check the three UIs
  ```bash
  ( cd .. && node_modules/.bin/tsc --noEmit -p tsconfig.json )   # web console
  ( cd foodyzz   && ./node_modules/.bin/tsc --noEmit )
  ( cd foodyzzhq && ./node_modules/.bin/tsc --noEmit )
  ```
- [ ] ✅ All four report **0 errors**.

---

## Phase 1 — 🔴 Pre-deploy BLOCKERS

### 1a. 🔴 Migrate the Stripe secret to the server-only doc

The admin console no longer stores or writes Stripe secrets. The backend reads them from
`apiConfigSecret/stripe` and only *falls back* to the inline copy in `apiConfig/global`.
**If the secret isn't in `apiConfigSecret/stripe`, the first config-save from the console
strips the inline copy and every payment/capture/deposit + the webhook check breaks.**

- [ ] Populate `apiConfigSecret/stripe` with `secretKey` **and** `webSecret`. Either via the
      Firebase console (add the two fields to that doc), or with admin credentials:
  ```bash
  # requires GOOGLE_APPLICATION_CREDENTIALS (service account) + the CURRENT live values
  node -e '
    const a=require("firebase-admin");a.initializeApp({projectId:"foodyzz-27b3e"});
    a.firestore().doc("apiConfigSecret/stripe").set(
      { secretKey: "sk_live_XXXX", webSecret: "whsec_XXXX" }, { merge:true }
    ).then(()=>{console.log("stripe secret migrated");process.exit(0)});
  '
  ```
- [ ] ✅ **Do NOT delete the inline `apiConfig/global.stripe.secretKey` yet** — leave it as a
      fallback until Phase 2 verifies a payment works from the secret doc. (It's harmlessly
      stripped the next time an admin saves config.)
- [ ] ✅ Confirm Firestore rules deny `apiConfigSecret/*` to clients (already the case:
      `stats/{date}`-style admin-only rules; `apiConfigSecret` is default-deny).

### 1b. 🔴 Exercise the live Stripe money-path in staging

The transaction/idempotency rewrites (`createPaymentIntent`, `capturePaymentIntent`,
`chargeDeposit`) are **not covered by the offline suite** (those tests skip without a key).

- [ ] ⚙️ In a staging project, run the live-mode tests:
  ```bash
  cd functions
  STRIPE_TEST_KEY=sk_test_XXXX npm test
  ```
- [ ] ✅ Manually walk one order end-to-end in staging: **authorize → capture on delivery →
      deposit charge**, then **retry each call** and confirm Stripe **deduplicates** (no double
      authorization/capture/charge) rather than erroring.

---

## Phase 2 — Deploy backend (functions + rules/indexes)

- [ ] ✅ Confirm you're on the intended project: `firebase use foodyzz-27b3e`
- [ ] ⚙️ Deploy Firestore rules + indexes (no changes this release, but keep them in sync):
  ```bash
  firebase deploy --only firestore:rules,firestore:indexes
  ```
- [ ] ⚙️ Deploy functions (runs `tsc` via predeploy):
  ```bash
  firebase deploy --only functions
  ```
  This ships: payment fixes, the `platformCounts` aggregate triggers, paginated
  `bulkBroadcast`, cached nodemailer transporter, per-function memory/timeout tuning.
  It also **removes** `processMarketingInvoices` and `checkSlotAvailability`.
- [ ] ✅ Verify a live payment now works reading from `apiConfigSecret/stripe` (a real
      authorize on a test order). Once confirmed, the inline secret from 1a can be dropped.
- [ ] ⚙️ `firebase functions:log --only createPaymentIntent,capturePaymentIntent` — no errors.

---

## Phase 3 — Backfill the aggregate counts

The `platformCounts` doc is maintained *going forward* by the triggers just deployed. Backfill
seeds it from existing data so the admin console shows correct numbers immediately. **Run this
AFTER Phase 2** (so triggers cover the gap) — never before.

- [ ] ⚙️
  ```bash
  cd functions
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json GCLOUD_PROJECT=foodyzz-27b3e npm run backfill:counts
  ```
- [ ] ✅ Output prints sane totals (orders/users/providers/pendingLicenses). It's idempotent —
      safe to re-run any time to reconcile counter drift.

---

## Phase 4 — Deploy the web admin console

There is **no Firebase Hosting block** in `firebase.json` — the CRA app builds to `build/` and
deploys to wherever you currently host it. Do this **after** Phase 1a (secret migration).

- [ ] ⚙️ `npm run build`  (from repo root → outputs `build/`)
- [ ] ⚙️ Deploy `build/` to your host.
- [ ] ✅ Log in, confirm: nav badges show correct counts (from `platformCounts`), the Settings
      tab no longer shows Stripe secret fields, and each tab (Insights/Customers/Rentals/Bikes/
      Licenses/Chat) loads its data when opened (listeners are now tab-scoped).

---

## Phase 5 — Deploy the mobile apps (EAS)

Both `foodyzz` and `foodyzzhq` are Expo + `@react-native-firebase` (native SDK) with `eas.json`.
The changes this pass are **JS-only** (no new native modules), so an OTA update is viable — but a
fresh build is the safe default if you're unsure whether native deps drifted.

- [ ] ⚙️ For each app (`cd foodyzz`, then `cd foodyzzhq`):
  ```bash
  npx tsc --noEmit           # 0 errors gate
  # OTA (JS-only): eas update --branch production
  # or full build:  eas build --platform all   &&   eas submit --platform all
  ```
- [ ] ✅ **Device smoke test** (these were type-checked, not run):
  - **foodyzz:** login → onboarding → profile shows across tabs (the new `UserProfileContext`);
    open checkout and confirm the pay button **enables** once the Stripe key loads (no stuck
    "Preparing secure checkout…"); open a chat thread and scroll (bounded + virtualized).
  - **foodyzzhq:** dispatch a bike from a Ready-for-Delivery card (per-card listener now gated on
    the picker opening); open HQ Chat and scroll (FlatList); verify the unread badge.

---

## Phase 6 — Post-deploy cleanup + verification

- [ ] ⚙️ 🔴 Delete the orphaned scheduler job for the removed cron (Firebase removes the function
      but the Cloud Scheduler job can linger and keep firing):
  ```bash
  gcloud scheduler jobs delete firebase-schedule-processMarketingInvoices-us-central1 \
    --location us-central1 --project foodyzz-27b3e
  ```
  (No cleanup needed for `checkSlotAvailability` — it's an HTTP callable, removed cleanly.)
- [ ] ✅ `firebase functions:list` — confirm `processMarketingInvoices` and
      `checkSlotAvailability` are gone; the new resource limits show on `scheduledDepositRelease`
      / `chargeRentToBuyInstallments` (512MiB / 540s).
- [ ] ✅ Confirm SMTP is configured (`apiConfigSecret/smtp` has host/user/pass) so the cached
      transporter can send — a lifecycle email (e.g. a test signup) should arrive.
- [ ] ✅ Watch `firebase functions:log` for ~15 min after first real traffic — no unexpected
      errors from the changed triggers/payment paths.

---

## Rollback notes

- **Functions:** redeploy the previous code (`firebase deploy --only functions` from the prior
  revision). Removed functions/triggers come back; the aggregate triggers are additive and safe.
- **Stripe secret:** the safest guard is Phase 1a's rule — keep the inline `apiConfig/global`
  secret until a payment is verified against `apiConfigSecret/stripe`. If payments fail
  post-deploy, re-add the inline secret and it works again immediately.
- **platformCounts drift:** re-run `npm run backfill:counts` — it overwrites, never appends.
- **Web / mobile:** redeploy the prior build / `eas update` the prior branch.

---

## Known limits shipped with this release (not blockers)

- Admin console tabs still load a full collection when opened (search/bucketing need it) —
  fine until total data is large; per-tab pagination is a follow-up.
- `platformCounts` and `stats/{date}` are single hot counter docs — shard them (distributed
  counter) before sustained high write throughput. See the capacity notes.
- Mobile chat shows the most recent 100 messages (no "load older" yet).
