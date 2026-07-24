# QA harness

Automated tests for the Laundry monorepo. Four layers:

| Layer | Where | Runs here? | Command |
|---|---|---|---|
| Backend transactions | `functions/src/__tests__/` (Jest + firebase-functions-test on the emulator) | ✅ | `cd functions && npm test` |
| Stripe payment flows | `functions/src/__tests__/payments.test.ts` (real Stripe **test mode**) | ✅ (opt-in) | `STRIPE_TEST_KEY=sk_test_… npm --prefix functions test` |
| Firestore rules | `firestore-tests/rules.test.js` | ✅ | `cd firestore-tests && npm test` |
| E2E UI | `.maestro/*.yaml` (Maestro on a simulator) | ⚠️ simulator-only | see below |

Prereqs for the emulator-backed suites: **JDK 21+** and the **Firebase CLI** (both already present in this repo's dev setup).

## Backend transaction suite

`cd functions && npm test` — boots the Firestore + Auth emulators (`firebase emulators:exec`), then runs Jest. Each callable is invoked via `firebase-functions-test`'s `wrap()` with `{ data, auth }`; triggers are invoked with constructed snapshots/changes. The admin SDK auto-connects to the emulator (env injected by `emulators:exec`). External I/O is isolated: Expo push is asserted via a `fetch` spy (never sent), Google Maps is avoided by using drop-off orders, Stripe is test-mode only.

Covered: `claimOrder` (confirm + re-auth branch + precondition), `cancelOrder` (provider vs customer, stats, terminal guard), `adjustOrderFinalPrice` (auth + pricing), and triggers `onOrderCreatedNotify` (broadcast zip fan-out + direct), `onCustomerMessageSent`, `onOrderCancelledNotifyProvider`, `onOrderCreatedUpdateStats`.

## Stripe payment flows

Opt-in (so the suite stays green without credentials): set a **test** secret key.
```
STRIPE_TEST_KEY=sk_test_xxx npm --prefix functions test
```
Runs the real test-mode money path: `createPaymentIntent` (manual-capture hold) → confirm with `pm_card_visa` → `capturePaymentIntent`, asserting the captured amount equals the computed breakdown. Without the key the live block is **skipped** (not failed). Captures appear in the Stripe **test** dashboard.

## Firestore rules

`cd firestore-tests && npm test` — compiles `firestore.rules` and asserts the allow/deny matrix (provider ownership, order create/update, `apiConfigSecret` secrecy, tax table, self-only user/archive writes, default-deny of server-only collections).

## E2E UI (Maestro, simulator)

Not runnable headless — needs a simulator + dev build. Steps:

1. **Start + seed the emulator**
   ```
   firebase emulators:start --only firestore,auth --project demo-laundry   # terminal 1
   FIRESTORE_EMULATOR_HOST=localhost:8080 GCLOUD_PROJECT=demo-laundry \
     npm --prefix functions run seed:emulator                              # terminal 2
   ```
2. **Build a dev client pointed at the emulator** (the flag wires `useEmulator` in `*/src/services/firebase.ts`; it's a strict no-op in production):
   ```
   EXPO_PUBLIC_USE_EMULATOR=1 npx expo run:ios   # in scrubs/ and scrubshq/
   ```
   (Android emulator: also set `EXPO_PUBLIC_EMULATOR_HOST=10.0.2.2`.)
3. **Configure a Firebase test phone number** (Auth → Sign-in method → Phone → test numbers), e.g. `+14025550000 → 123456`. The apps already set `appVerificationDisabledForTesting` in `__DEV__`.
4. **Run the flows**
   ```
   maestro test .maestro/customer_place_order.yaml
   maestro test .maestro/provider_claim_cancel.yaml
   ```

### Before E2E will pass — finish the instrumentation
The flow files use placeholder selectors. Confirm the labels and add these `testID`s:
- `scrubs` OrderWizard submit button → `testID="order-submit"`
- `scrubshq` Dispatch claim button → `testID="order-claim"`, cancel button → `testID="order-cancel"`

These are the only manual TODOs; everything else above runs as-is.
