# QA Checklist — June 2026 Refactor

Covers the broadcast-radius, per-provider pricing, priority surcharge, payout
state-machine, Stripe Connect, auto-complete, and provider-data-isolation changes.
Collections are **wiped before each retest run** (no migration/backfill needed).

## Automated (run these first)

| Check | Command | Expected |
|---|---|---|
| Cloud Functions typecheck | `cd functions && npx tsc --noEmit` | exit 0 |
| Customer app typecheck | `cd scrubs && npx tsc --noEmit` | exit 0 |
| Provider app typecheck | `cd scrubshq && npx tsc --noEmit` | exit 0 |
| Admin web typecheck | `npx tsc --noEmit -p tsconfig.json` | exit 0 |
| **Firestore rules suite** | `cd firestore-tests && npm test` | "All rule assertions passed" |
| Maestro: customer order | `.maestro/customer_place_order.yaml` | order created |
| Maestro: provider claim/cancel | `.maestro/provider_claim_cancel.yaml` | claim + cancel ok |

Last run: all four typechecks **pass**; rules suite **passes** (28 assertions incl.
new restricted order-read, `providerOrders` mirror, `payouts` ledger).

## Manual — Broadcast radius targeting (headline)
- [ ] Provider onboarding **writes lat/lng** (Places pick OR typed→geocode). Confirm
      `providers/{id}.lat` & `.lng` are numbers in Firestore. *(Without these a store
      gets ZERO broadcasts — fixed in ProviderOnboardingWizard.)*
- [ ] Customer broadcast order stores `customerLat/customerLng` + `broadcastRadius`.
- [ ] Only providers **within** `broadcastRadius` of the order anchor receive the
      push (check `onOrderCreatedNotify` logs `→ N providers within Xmi`).
- [ ] In-range provider sees the order in Dispatch feed; out-of-range does NOT.
- [ ] Zip radius search returns the correct in-range provider set (regression: was
      not producing results).

## Manual — Pricing parity (customer / provider / admin)
- [ ] Broadcast checkout shows live worst-case ceiling (`getBroadcastPricePreview`),
      debounced, with no flicker; quoted total == amount authorized.
- [ ] Directed order prices from the selected provider's own rates.
- [ ] At claim, settlement recomputes from the **claiming** provider's prices
      (≤ ceiling) → captured ≤ authorized; rare over-ceiling routes to re-auth.
- [ ] Provider net pay (Dispatch/Logistics/Deposits) all agree and show the
      **By Load / By Weight** basis indicator. *(Deposits now passes providerProfile
      — previously would have shown ~$0.)*
- [ ] Admin EarningVault totals match provider's net.

## Manual — Onboarding (normal + priority)
- [ ] Normal turnaround + per-load/per-weight/dry-clean prices persist.
- [ ] Priority toggle + flat surcharge persists (`chargesPriorityFee`,`priorityPrice`).
- [ ] `salesTaxByZip/{zip}` rollup updates with field-wise MAX of in-zip providers.

## Manual — Approvals + resend
- [ ] Price adjustment → customer gets push/SMS; order → `pending_customer_confirmation`.
- [ ] Provider "Resend Notice" re-sends without changing state (`resendApprovalRequest`).
- [ ] Approve resumes at the **correct** status (`adjustmentResumeStatus`, e.g. back
      to `confirmed`, not skipping the pickup flow).
- [ ] Customer history/transaction shows the **By Load/Weight/Item** adjustment indicator.

## Manual — Stripe Connect + payouts
- [ ] PayoutSetup "Set Up Payouts" opens Stripe Express onboarding; return shows
      "Payouts Connected"; leaving mid-flow does not crash (unmount-guarded).
- [ ] Admin deposit (`runProviderPayout`) only offers settled+unpaid orders, one
      provider per call, disables button while in-flight, marks orders `payoutStatus:'paid'`.
- [ ] Scheduled standard (1st/15th) and daily cadence transfer only **settled** funds.

## Manual — Auto-complete + data isolation
- [ ] One-tap completion folds delivery/pickup into `delivered` (no manual workflow step).
- [ ] Provider app reads **only** `providerOrders` (no customer charge fields visible);
      `orders` reads by a non-owner are denied (rules suite covers this).
- [ ] Customer notes show on the scrubsHQ Dispatch customer card below service time.
