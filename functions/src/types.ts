export enum OrderStatus {
  REQUESTED = "requested",
  // Accepted by FoodyzzHQ. The order stays in the Order Stream while the rider's
  // ID and proof of address are collected and verified.
  CONFIRMED = "confirmed",
  // Documents verified — the order leaves the Order Stream for Operations.
  READY_FOR_DELIVERY = "ready_for_delivery",
  EN_ROUTE_DELIVERY = "en_route_delivery",
  AT_DELIVERY = "at_delivery",
  // Bike handed over: rental captured, deposit held, condition recorded.
  DELIVERED = "delivered",
  // Bike returned and the deposit released.
  COMPLETED = "completed",
  CANCELLED = "cancelled",
}

export enum AppRole {
  CUSTOMER = "customer",
  PROVIDER = "provider",
  ADMIN = "admin",
}

export interface UserProfile {
  phoneNumber: string;
  name: string;
  email: string;
  address: string;
  zipCode?: string;
  isBlocked?: boolean;
  fcmToken?: string;
  // Driver license on file. Can be scanned ahead of time from the account profile,
  // or captured right after FoodyzzHQ accepts an order. A provider skips the
  // ID request entirely when a reviewed license is already present (repeat user).
  driverLicense?: DriverLicense;
  // Proof of address on file (same lifecycle as the license).
  addressProof?: CustomerDocument;
  // Sales-rep referral attribution (visibility / thank-you only — does not earn
  // the manager commission; only the provider's referrer earns).
  // Promo ids this customer has redeemed, written by onOrderCreatedRedeemPromo. Lives
  // here — on the customer's own doc — rather than as a roster of redeemers on the
  // promo, which is world-readable and streamed to every home screen.
  redeemedPromoIds?: string[];
}

export interface ProviderProfile {
  phoneNumber: string;
  zipCode: string;
  businessName: string;
  email: string;
  address: string;
  onboarded: boolean;
  // Provider self-declares whether they collect sales tax and at what rate
  // (decimal, e.g. 0.08625). The platform passes this through to the customer;
  // the provider is the merchant of record and remits it. 0 / unset = no tax.
  chargesSalesTax?: boolean;
  salesTaxRate?: number;
  // LEGACY single-device push token. A store can now have several members, each
  // on their own device, so the current apps write `fcmTokens` instead. Kept and
  // still delivered to so devices running an older build keep receiving pushes;
  // see providerPushTokens().
  fcmToken?: string;
  // Every registered device for this store (one per signed-in member). Written
  // with arrayUnion by the client; dead tokens are pruned with arrayRemove when
  // Expo reports DeviceNotRegistered.
  fcmTokens?: string[];
  isBlocked?: boolean;
  // Sales-rep referral attribution. Set once when the provider enters a school
  // manager's code in the command-center modal (one fleet = one manager).
}

// ── Store membership ────────────────────────────────────────────────────────
//
// A store is `providers/{phone}_{identifier}`, whose doc id embeds the phone of
// whoever created it. That made the creator the only possible user of the store.
// Membership decouples the two: access to a store is `providers/{id}/members/
// {E164phone}` existing, not the doc id matching your phone.
//
// Written ONLY by the server (redeemHqInvite, and onProviderCreatedAddOwner for
// the creator) — firestore.rules denies client writes, since a self-writable
// member doc would let anyone join any store.
export interface StoreMember {
  // E.164, matching request.auth.token.phone_number AND this doc's id. Stored as
  // a field as well so the client can find every store a phone belongs to with a
  // single collection-group query.
  phone: string;
  // 'owner' created the store; 'staff' joined via an invite. Currently
  // informational — both can operate the store — except that only an owner may
  // delete it (firestore.rules).
  role: "owner" | "staff";
  name?: string;
  addedAt: string;
  // E.164 of whoever issued the invite, when known.
  invitedBy?: string;
}

// A single-use join code issued by a manager for ONE specific phone, redeemed
// once by redeemHqInvite. `invites/{CODE}` is deny-all to clients: the code IS
// the credential, so a readable collection would be an enumerable key ring.
export interface StoreInvite {
  // E.164. The redeeming caller's phone_number claim must equal this exactly.
  phone: string;
  providerId: string;
  role: "owner" | "staff";
  name?: string;
  used: boolean;
  createdAt: string;
  // ISO. Past this the code is dead even if unused.
  expiresAt: string;
  createdBy?: string;
  usedAt?: string;
  // Set instead of deleting, so a spent or withdrawn code stays auditable.
  revokedAt?: string;
}

// Cloud Storage paths (NOT download URLs) of an uploaded document. Reads go through
// Storage rules: the owning customer, or Foodyzz staff (admin claim).
// `reviewedAt`/`reviewedBy` are stamped when staff eyeball the images and accept them.
export interface CustomerDocument {
  frontPath: string;
  backPath?: string;
  uploadedAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  rejectedReason?: string | null;
}

// Kept as an alias so existing driverLicense references stay valid.
export type DriverLicense = CustomerDocument;

// Condition of the bike at handover, captured by FoodyzzHQ with the customer present
// so both sides hold the same record. Photos live in Storage under
// bikeCondition/{orderId}/.
export interface BikeConditionReport {
  notes?: string;
  photoPaths: string[];
  recordedAt: string;
  recordedBy?: string;
}

// Where a bike-collection run has got to. The order stays DELIVERED throughout:
//   ready_for_pickup — announced to the customer ("we're on our way, please be home")
//   at_location      — staff are outside; next tap is either check-in or "not present"
//   inspecting       — staff have the check-in sheet open and are going over the bike
//                      with the customer. Set by FoodyzzHQ, not by a callable, and
//                      cleared when the check-in completes (or reverted if they back
//                      out) — so the customer's Rental Due flow shows the inspection
//                      happening rather than jumping straight from "outside" to done.
export type ReturnStage = "ready_for_pickup" | "at_location" | "inspecting";

// A collection run that found nobody home. The bike stays out, so the rental renews
// for another term and the customer pays for it plus the wasted trip (admin fee).
export interface PickupAttempt {
  at: string;                     // ISO, when staff reported nobody home
  recordedBy?: string | null;     // providerId of the store that made the trip
  // The renewal this attempt triggered.
  renewedFrom?: string | null;    // previous expectedEndDate (YYYY-MM-DD)
  renewedTo?: string | null;      // new expectedEndDate (YYYY-MM-DD)
  periods?: number;               // terms added
  unit?: "weeks" | "months";
  rentalCharge: number;           // renewed rental incl. its tax + card fee
  adminFee: number;               // apiConfig/logistics.pickupFee
  total: number;                  // what the card was actually asked for
  paymentIntentId?: string | null;
  error?: string | null;          // set when the card declined — needs manual follow-up
}

// A customer-facing receipt for ONE payment taken after checkout. The original
// rental charge is described by the order's own pricing fields (orderSubtotal / tax /
// chargedAmount), so it needs no entry here; every LATER payment on the same order —
// today only a missed-collection renewal — appends one of these, so My Rentals can
// show that charge with the same breakdown the delivery receipt has.
export interface OrderReceipt {
  id: string;            // stable per event ("renewal-1"), so a retry can't duplicate it
  kind: "renewal";
  issuedAt: string;      // ISO
  title: string;         // headline shown to the customer
  subtitle?: string;     // e.g. the term the payment bought
  periodFrom?: string | null; // YYYY-MM-DD the renewed term runs from
  periodTo?: string | null;   // YYYY-MM-DD it now runs to
  lines: { label: string; amount: number }[]; // pre-tax line items; sum to `subtotal`
  subtotal: number;
  taxesAndFees: number;  // sales tax + card processing, combined as customers see it
  // Flat charges applied AFTER tax (the missed-collection admin fee is untaxed), so
  // they sit between "taxes and fees" and the total rather than inside the subtotal.
  extraLines?: { label: string; amount: number }[];
  total: number;         // what the card was asked for
  paid: boolean;         // false when the card declined — the term still renewed
  paymentIntentId?: string | null;
  error?: string | null;
}

// ── Settlement ledger (settlements/{stripeId}) ──────────────────────────────
// One document per money movement through Stripe: the delivery charge, the security
// deposit, its refund, a missed-collection renewal, a rent-to-buy installment, a tip.
// The order documents describe what the CUSTOMER agreed to pay; this ledger records
// what actually moved and, crucially, what Stripe kept for moving it — the balance
// transaction's fee is nowhere on the order, so program margin can't be read without
// it. Server-written, admin-read (firestore.rules); the customer never sees it.
export type SettlementKind =
  | "rental" // the delivery capture — the first period / the whole term
  | "deposit" // the refundable security deposit, charged as its own transaction
  | "deposit_refund" // that deposit going back, minus any damage adjustments
  | "renewal" // a term renewed because staff found nobody home at collection
  | "installment" // one rent-to-buy period
  | "tip"; // post-delivery, provider-kept, untaxed

export interface Settlement {
  id: string; // Stripe PaymentIntent id (or refund id) — also the document id
  orderId: string;
  kind: SettlementKind;
  at: string; // ISO — when the money moved. The ledger's only sort/filter key.
  // Signed, in dollars: charges positive, refunds negative. This is the gross the
  // card was asked for, which is what Stripe's fee is computed against.
  amount: number;
  // The split of `amount` as WE billed it. subtotal + tax + chargedCcFee ≈ amount
  // (a deposit is all subtotal; a tip is untaxed and carries no card-fee line).
  subtotal: number;
  tax: number;
  chargedCcFee: number; // the card-processing line item the customer paid us
  // The fee-table portion of `subtotal` — setup/protection/whatever the fee bundle
  // holds, plus the missed-collection admin fee. The bike itself is subtotal − this.
  serviceFees: number;
  // What Stripe ACTUALLY took, and what it actually paid us, from the charge's
  // balance transaction. null while the balance transaction isn't readable yet —
  // syncStripeSettlements backfills those. stripeNet = amount − stripeFee.
  stripeFee: number | null;
  stripeNet: number | null;
  availableOn: string | null; // when the funds land in the platform balance
  currency: string;
  // Denormalized so the ledger renders without fanning out to orders/users.
  customerPhone: string;
  customerName: string;
  providerId: string;
  providerName: string;
  updatedAt: string;
}

// ── Foodyzz bike-rental domain ──────────────────────────────────────────────

// How the customer takes the bike. Rent is billed per week, rent-to-buy per month,
// buy is a one-time price. Rent-to-buy and buy always start from NEW inventory.
export type RentalType = "rent" | "rentToBuy" | "buy";

export type BikeCondition = "new" | "used";

export type BikeStatus = "available" | "reserved" | "rented" | "sold" | "maintenance";

// apiConfig/logistics → bikeModels[]. Rates keyed by rental type.
export interface BikeModelConfig {
  model: number;
  name: string;
  imageUrl: string;
  rates: { rent: number; buy: number; rentToBuy: number };
  // Minimum number of periods the customer must commit to. Buy has none.
  minCommitment: { rent: number; rentToBuy: number };
}

// apiConfig/logistics → fees[]. `required` fees cannot be opted out of. The
// deposit (isDeposit) is never part of the rental invoice — it is secured
// separately against a saved card.
export interface FeeConfig {
  key: string;
  label: string;
  amount: number;
  required: boolean;
  cadence: "once" | "weekly" | "monthly";
  isDeposit?: boolean;
}

// apiConfig/logistics — every appendix table, in one admin-editable document.
export interface LogisticsConfig {
  bikeModels: BikeModelConfig[];
  durationUnits: { rent: "weeks"; rentToBuy: "months" };
  // Starting counts per model. The `bikes` collection is the live truth once
  // bikes start moving; this is the restock baseline the admin edits.
  inventory: Record<string, { new: number; used: number }>;
  fees: FeeConfig[];
  // Delivery window customers pick a slot from (appendix: 5pm–9pm).
  delivery: { startTime: string; endTime: string; slotMinutes: number };
  // Days after a bike's expected end date before it can be re-rented. Drives the
  // "expected availability" date shown when a model is fully rented out.
  restockDays: number;
}

// bikes/{id} — one document per physical bike.
export interface Bike {
  id: string;
  model: number;
  bikeNo: number;
  condition: BikeCondition;
  status: BikeStatus;
  rentedBy?: string | null; // customer phone (E.164)
  rentedDate?: string | null; // YYYY-MM-DD the rental starts
  rentalDuration?: string | null; // e.g. '4 weeks'
  expectedEndDate?: string | null; // YYYY-MM-DD
  currentOrderId?: string | null;
  createdAt: string;
}

// bikes/{id}/history/{entryId} — append-only rental history (appendix table).
export interface BikeHistoryEntry {
  orderId: string;
  model: number;
  bikeNo: number;
  rentedBy: string;
  rentedByName?: string;
  rentedDate: string;
  rentalDuration: string;
  expectedEndDate: string;
  returnedDate?: string | null;
  rentalType: RentalType;
}

// A fee as accepted by the customer at checkout — snapshotted onto the order so a
// later config edit never rewrites what they agreed to pay.
export interface OrderFee {
  key: string;
  label: string;
  amount: number;
  required: boolean;
  cadence: "once" | "weekly" | "monthly";
  accepted: boolean;
}

// Rent-to-buy is billed one period at a time, not as a lump term. The plan is the
// priced installment (rate + recurring fees + tax + card fee for a single period),
// fixed at checkout so a later config edit never changes what the customer signed up
// to pay each cycle.
export interface RentToBuyPlan {
  periodsTotal: number; // number of due periods = model.minCommitment.rentToBuy
  unit: "weeks" | "months";
  // How often installments are billed. Defaults to 'monthly'; 'daily'/'weekly' let a
  // plan run to completion quickly for testing. Read from minCommitment.rentToBuyCadence.
  cadence?: "daily" | "weekly" | "monthly";
  perPeriodSubtotal: number; // rate + recurring fees for one period (no tax/card fee)
  perPeriodTax: number;
  perPeriodCcFee: number;
  perPeriodAmount: number; // charged each cycle — subtotal + tax + card fee
  taxRate: number;
}

// The live installment schedule, created at delivery once period 1 is captured and
// advanced by the chargeRentToBuyInstallments cron until every period is paid.
export interface BillingSchedule {
  periodsTotal: number;
  periodsCharged: number; // 1 after the delivery capture
  perPeriodAmount: number;
  unit: "weeks" | "months";
  cadence?: "daily" | "weekly" | "monthly"; // billing interval; defaults to 'monthly'
  nextChargeAt: string | null; // null once completed or handed to manual follow-up
  status: "active" | "past_due" | "completed" | "canceled";
  paymentMethodId: string; // the card retained at delivery
  retryCount: number; // failed attempts on the CURRENT period; past_due at 2
  lastError?: string;
  lastChargedAt?: string;
  lastPaymentIntentId?: string;
}

export interface RentalOrder {
  id: string;
  // ── Bike rental (Foodyzz) ────────────────────────────────────────────────
  rentalType?: RentalType;
  bikeModel?: number;
  bikeId?: string | null; // assigned at delivery, not at order time
  // Placed while every free bike of this model was already claimed by an earlier
  // order. HQ must confirm it can be fulfilled before assigning a bike.
  waitlisted?: boolean;
  bikeNo?: number | null;
  bikeCondition?: BikeCondition;
  startDate?: string; // YYYY-MM-DD, defaults to tomorrow
  deliveryTime?: string; // slot label within the 5–9pm window
  deliveryTimeConfirmedAt?: string; // stamped when FoodyzzHQ confirms the slot
  durationValue?: number; // periods committed to
  durationUnit?: "weeks" | "months";
  expectedEndDate?: string; // YYYY-MM-DD = startDate + duration
  baseRate?: number; // per-period rate (or the buy price)
  // Fees the customer saw and accepted; required ones are always accepted:true.
  // The deposit fee is listed here for disclosure but excluded from the invoice.
  fees?: OrderFee[];
  // Deposit is CHARGED as a real second transaction at delivery, then refunded at
  // return minus any damage adjustments the provider applies. ('secured'/'released'
  // are legacy states from the old card-hold model — kept so orders mid-flight before
  // the switch still resolve.) depositHoldUntil = expectedEndDate + 3 days.
  depositAmount?: number;
  depositHoldUntil?: string;
  depositStatus?: "none" | "secured" | "charged" | "released" | "refunded";
  depositPaymentMethodId?: string;
  depositPaymentIntentId?: string;
  depositChargedAmount?: number;
  depositSecuredAt?: string;
  depositChargedAt?: string;
  depositChargeReason?: string;
  // Damage/condition adjustments applied at return; each is subtracted from the deposit
  // before the balance is refunded.
  depositAdjustments?: { note: string; amount: number }[];
  depositAdjustmentTotal?: number; // capped at depositAmount
  depositRefundedAmount?: number; // deposit − adjustments, refunded to the card
  depositRefundId?: string; // Stripe refund id
  depositRefundedAt?: string;
  // Set on return: when the deposit obligation lapses (completedAt + 2 days). Legacy —
  // only the old card-hold ('secured') path still uses it.
  depositReleaseAt?: string;
  depositReleasedAt?: string;
  depositError?: string;
  // Rent-to-buy financing. The plan is priced at checkout; the schedule is created at
  // delivery once the first period is captured, then advanced by the installment cron.
  rentToBuyPlan?: RentToBuyPlan;
  billingSchedule?: BillingSchedule;
  rentToBuyOwned?: boolean; // true once every period is paid — the bike is theirs
  rentToBuyOwnedAt?: string;
  // ── Return pickup run ────────────────────────────────────────────────────
  // Collecting a bike is a scheduled visit, not an instant event: staff announce the
  // run, arrive on site, and only then check the bike in. The order stays DELIVERED
  // (the rental is still running and still billable) for the whole run, so its
  // progress lives here rather than in `status`. Cleared when the run ends — either
  // the bike is checked in, or the customer wasn't there and the rental renews.
  returnStage?: ReturnStage | null;
  returnStageAt?: string | null; // when the current stage was entered
  // One entry per attempted collection that FAILED (customer not present). Each
  // records the renewal that was charged as a result.
  pickupAttempts?: PickupAttempt[];
  missedPickups?: number; // pickupAttempts.length, denormalized for display
  // Running total of everything charged by failed-pickup renewals (rental + admin fee).
  renewalChargedTotal?: number;
  // Receipts for payments taken AFTER the delivery charge (renewals). Append-only.
  receipts?: OrderReceipt[];
  // The due date the "your rental ends in 2 days" reminder was last sent for. Keyed on
  // the date itself so a renewal (which moves expectedEndDate out) gets its own
  // reminder, while a re-run of the cron on the same date does not send twice.
  dueReminderSentFor?: string | null; // YYYY-MM-DD
  dueReminderSentAt?: string | null;  // ISO
  // Condition recorded when the bike comes back, to compare against handover.
  conditionAtReturn?: BikeConditionReport;
  // Bike condition recorded at handover — notes + photos, visible to both sides.
  conditionAtDelivery?: BikeConditionReport;
  // Stamped when FoodyzzHQ verifies BOTH documents; gates Ready for Delivery.
  docsVerifiedAt?: string;
  // Stamped when staff reject the documents and ask for a replacement set.
  docsRejectedAt?: string;
  idRequestedAt?: string;
  readyForDeliveryAt?: string;
  customerPhone: string;
  customerName: string;
  customerAddress: string;
  status: OrderStatus;
  estimatedPrice: number;
  // Worst-case authorized hold (broadcast = max across in-range providers). Preserved
  // through settlement so the customer can see the ceiling vs the actual charge.
  authorizedCeiling?: number;
  finalPrice?: number;
  providerId: string;
  providerName: string;
  providerPhone?: string;
  createdAt: string;
  updatedAt?: string;
  confirmedAt?: string;
  // Persisted pricing breakdown (authoritative — written to equal the Stripe charge).
  // orderSubtotal is commission-inclusive; taxRate is the rate actually applied.
  orderSubtotal?: number;
  platformFee?: number;
  deliveryFee?: number | null;
  tax?: number;
  taxRate?: number;
  ccProcessingFee?: number;
  couponCode?: string | null;
  couponDiscount?: number | null;
  // The promos/{id} the code came from. onOrderCreatedRedeemPromo uses it to confirm
  // the redemption claim, so the code can't be spent a second time.
  couponPromoId?: string | null;
  adjustedSubtotal?: number;
  adjustedDeliveryFee?: number;
  adjustedTax?: number;
  adjustedProcessingFee?: number;
  // Optional free-text note the provider attaches to a price adjustment, shown to
  // the customer with the adjustment (notification + order/transaction detail).
  // Distinct from the provider-private card note.
  adjustmentNote?: string | null;
  // Two-part scheduling (see the customer app RentalOrder). *Day = local YYYY-MM-DD,
  // *Time = single label ("10:00 AM"). turnaroundDays = needByDay − handoffDay.
  pickupDay?: string | null;
  pickupTimeWindow?: string | null;
  handoffDay?: string | null;
  handoffTime?: string | null;
  needByDay?: string | null;
  needByTime?: string | null;
  needBy?: string;
  notes?: string;
  // ISO timestamp written when the order is marked delivered/completed.
  completedAt?: string;
  paymentCaptured?: boolean;
  paymentIntentId?: string;

  // When the captured charge's funds become available in the platform Stripe
  // balance (~3 days). ISO string.
  chargeAvailableOn?: string;

  // ── Money audit trail (write-once per lifecycle event; for future audits) ──
  authorizedAmount?: number; // the hold placed at checkout
  authorizedAt?: string;
  chargedAmount?: number; // the amount actually captured
  chargedAt?: string;
  adjustments?: AdjustmentEntry[]; // append-only history of customer-amount changes
  // Status to restore after a claim-time tax re-auth completes (see claimOrder /
  // finalizeAdjustedReauth). Absent for a normal post-pickup price adjustment.
  reauthResumeStatus?: OrderStatus;
  // Status the order was in when a provider price adjustment was made, captured so
  // approval resumes the lifecycle exactly where it paused (e.g. confirmed →
  // pending_customer_confirmation → back to confirmed) rather than jumping ahead.
  adjustmentResumeStatus?: OrderStatus;
  rating?: number;
  feedback?: string;
  ratedAt?: string; // ISO timestamp when the customer submitted their rating

  // ── Post-delivery tip ──────────────────────────────────────────────────────
  // A tip is added by the customer AFTER delivery, charged on a SEPARATE payment
  // intent (the original charge is already captured). It is flat, untaxed and
  // commission-free (mirrors the priority surcharge).
  tip?: number;
  tipPaymentIntentId?: string; // Stripe PI for the tip charge (hidden from provider mirror)
  tipChargedAt?: string; // ISO timestamp the tip was captured
  tipChargeAvailableOn?: string; // when the tip charge's funds settle (~3 days)
  providerLocation?: { lat: number; lng: number; timestamp: string; };
  providerCurrentStatus?: string;
}

// Append-only audit entry for every change to the customer's charged amount.
export interface AdjustmentEntry {
  at: string; // ISO timestamp
  by: "provider" | "system" | "customer"; // who/what drove the change
  reason: string; // e.g. 'claim-settle', 'provider-adjust', 'claim-reauth'
  fromAmount: number; // customer total before
  toAmount: number; // customer total after
  paymentIntentId?: string; // the hold in force after the change
}

export interface PromoCampaign {
  id: string;
  providerId: string;
  providerName: string;
  price: number;
  text: string;
  expirationDate: string;
  viewsCounter: number;
  isActive: boolean;
}

export interface GlobalConfig {
  commissionRate: number;
  commissionRates?: number;
  minimumCommission?: number;
  promoCostPerCount: number;
  deliveryFee: {
    radius: number;
    pickupDelivery: number;
  };
  apiKeys: {
    googleMap: string;
  };
  stripe: {
    merchantId: string;
    publishableKey: string;
    secretKey: string;
    transactionFee: number;
    processingFee: number;
    webSecret?: string;
  };
}

export interface SupportMessage {
  id?: string;
  userPhone: string;
  userName: string;
  userRole: AppRole;
  senderPhone: string;
  senderName: string;
  text: string;
  timestamp: string;
  isReadByAdmin: boolean;
}

export interface MarketingInvoice {
  id: string;
  providerId: string;
  providerName: string;
  amount: number;
  currency: string;
  billedAt: string;
  promoCampaigns: any[];
  paymentStatus: "pending" | "paid" | "failed";
}

export interface DailyStats {
  date: string;
  totalRevenue: number;
  totalCommission: number;
  orderCount: number;
  cancelledCount: number;
  averageSatisfaction: number;
  ratingSum: number;
  ratedCount: number;
  updatedAt: any;
}

export interface ProviderPerformance {
  providerId: string;
  businessName: string;
  totalRevenue: number;
  ordersCompleted: number;
  completionRate: number;
  totalAttempts: number;
  ratingSum: number;
  ratedCount: number;
  avgRating: number;
  lastOrderAt: string;
  updatedAt?: any;
}
