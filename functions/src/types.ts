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
  stripeAccountId?: string;
  // Payout cadence: 'standard' = free 1st/15th batch; 'daily' = aggregate of each
  // day's settled funds, transferred daily for a per-transfer fee. Default standard.
  payoutCadence?: "standard" | "daily";
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
  couponDiscount?: number | null;
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

  // ── Payout state machine (dedicated fields — never overload depositStatus) ──
  // Provider-payout lifecycle, independent of the customer-charge flags above.
  // 'unpaid' at creation → 'paid' once a Connect transfer for this order completes.
  payoutStatus?: "unpaid" | "paid";
  // When the captured charge's funds become available in the platform Stripe
  // balance (~3 days). Payouts only include settled funds. ISO string.
  chargeAvailableOn?: string;
  payoutId?: string; // the Payout doc / Stripe transfer that paid this order
  depositedAt?: string; // when payoutStatus flipped to 'paid'

  // ── Money audit trail (write-once per lifecycle event; for future audits) ──
  authorizedAmount?: number; // the hold placed at checkout
  authorizedAt?: string;
  chargedAmount?: number; // the amount actually captured
  chargedAt?: string;
  depositedAmount?: number; // provider net transferred for this order
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
  // intent (the original charge is already captured). It is flat, untaxed,
  // commission-free and 100% provider-kept (mirrors the priority surcharge). It is
  // paid out independently of the base order so a tip arriving after the order has
  // already been settled is never double-paid (see tipPayoutStatus).
  tip?: number;
  tipPaymentIntentId?: string; // Stripe PI for the tip charge (hidden from provider mirror)
  tipChargedAt?: string; // ISO timestamp the tip was captured
  tipChargeAvailableOn?: string; // when the tip charge's funds settle (~3 days)
  tipPayoutStatus?: "unpaid" | "paid";
  tipPayoutId?: string; // the Payout/transfer that paid the tip
  tipDepositedAt?: string; // when tipPayoutStatus flipped to 'paid'
  providerLocation?: { lat: number; lng: number; timestamp: string; };
  providerCurrentStatus?: string;
  // Point-in-time copy of the fulfilling provider's referrer, stamped at order
  // creation so manager payouts/reports don't depend on later provider edits.
  // Manager-payout lifecycle, independent of the provider's payoutStatus.
  // Set to 'pending' when a managerId is stamped; 'deposited' once the order has
  // been rolled into a managerPayouts record; 'paid' once that payout is settled
  // (Stripe transfer succeeded or admin marked it paid). Drives the AdminHUB
  // outstanding-balance vs lifetime-paid split.
  managerPayoutStatus?: "pending" | "deposited" | "paid";
  managerDepositedAt?: any; // when rolled into a managerPayouts record
  managerPaidAt?: string; // when the manager was actually paid for this order
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
    // Per-transfer fee for the opt-in daily payout cadence (deducted from each
    // daily transfer). Admin-editable at apiConfig/global → stripe.dailyPayoutFee.
    dailyPayoutFee?: number;
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
