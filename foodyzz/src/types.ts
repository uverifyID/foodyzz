export enum OrderStatus {
  REQUESTED = 'requested',
  // Accepted by FoodyzzHQ. The order stays in the Order Stream while the rider's
  // ID and proof of address are collected and verified.
  CONFIRMED = 'confirmed',
  // Documents verified — the order leaves the Order Stream for Operations.
  READY_FOR_DELIVERY = 'ready_for_delivery',
  EN_ROUTE_DELIVERY = 'en_route_delivery',
  AT_DELIVERY = 'at_delivery',
  // Bike handed over: rental captured, deposit held, condition recorded.
  DELIVERED = 'delivered',
  // Bike returned and the deposit released.
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export enum AppRole {
  CUSTOMER = 'customer',
  PROVIDER = 'provider',
  ADMIN = 'admin',
}

export interface UserProfile {
  phoneNumber: string;
  name: string;
  email: string;
  address: string;
  zipCode?: string;
  lat?: number;
  lng?: number;
  // Driver license / address proof on file. Can be scanned ahead of time from the
  // account profile, or captured right after FoodyzzHQ accepts an order — a repeat
  // customer with a reviewed license is never asked again.
  driverLicense?: DriverLicense;
  addressProof?: DriverLicense;
  onboarded?: boolean;      // False until the profile onboarding wizard is completed
  isBlocked?: boolean;
  fcmToken?: string;
  isAdmin?: boolean;
  blockedProviders?: string[]; // Added for customer app filtering
  stripeCustomerId?: string;
  billingPaymentMethodId?: string;
  billingCardLast4?: string;
  billingCardBrand?: string;
  billingCardExpMonth?: number;
  billingCardExpYear?: number;
  billingCardName?: string;
  billingSetupAt?: string;
  // Sales-rep referral attribution (visibility / thank-you only — no commission).
  referredByManagerId?: string;
  referralCodeUsed?: string;
}

export interface ProviderProfile {
  phoneNumber: string;
  zipCode: string;
  businessName: string;
  email: string;
  address: string;
  onboarded: boolean;
  // Provider's self-declared sales tax (decimal, e.g. 0.08625). Used to compute
  // the tax line shown to the customer; 0 / unset means the provider charges none.
  chargesSalesTax?: boolean;
  salesTaxRate?: number;
  isBlocked?: boolean;
  stripeAccountId?: string;
  fcmToken?: string;
  slotCapacity?: number;
  pickupEnabled?: boolean;
  // Master availability. Undefined/true = active; false = paused (excluded from search).
  servicesActive?: boolean;
}

// Rent-to-buy installment plan, priced at checkout. `perPeriodAmount` is what the
// customer pays each due period (rate + recurring fees + tax + card fee).
export interface RentToBuyPlan {
  periodsTotal: number;
  unit: 'weeks' | 'months';
  cadence?: 'daily' | 'weekly' | 'monthly';   // billing interval; defaults to 'monthly'
  perPeriodSubtotal: number;
  perPeriodTax: number;
  perPeriodCcFee: number;
  perPeriodAmount: number;
  taxRate: number;
}

// Live installment schedule — created at delivery, advanced by the billing cron.
export interface BillingSchedule {
  periodsTotal: number;
  periodsCharged: number;
  perPeriodAmount: number;
  unit: 'weeks' | 'months';
  cadence?: 'daily' | 'weekly' | 'monthly';
  nextChargeAt: string | null;
  status: 'active' | 'past_due' | 'completed' | 'canceled';
  paymentMethodId: string;
  retryCount: number;
  lastError?: string;
  lastChargedAt?: string;
  lastPaymentIntentId?: string;
}

export interface RentalOrder {
  id: string;
  // ── Bike rental (Foodyzz) ────────────────────────────────────────────────
  rentalType?: RentalType;
  bikeModel?: number;
  bikeId?: string | null;            // assigned at delivery, not at order time
  bikeNo?: number | null;
  bikeCondition?: BikeCondition;
  startDate?: string;                // YYYY-MM-DD, defaults to tomorrow
  deliveryTime?: string;             // slot label within the 5–9pm window
  deliveryTimeConfirmedAt?: string;  // stamped when FoodyzzHQ confirms the slot
  durationValue?: number;            // periods committed to
  durationUnit?: 'weeks' | 'months';
  expectedEndDate?: string;          // YYYY-MM-DD = startDate + duration
  baseRate?: number;                 // per-period rate (or the buy price)
  // Fees the customer saw and accepted; required ones are always accepted:true.
  // The deposit fee is listed for disclosure but excluded from the invoice.
  fees?: OrderFee[];
  // Deposit is secured against a saved card rather than an uncaptured hold: a card
  // auth expires long before a 4-week (let alone 8-month) term. depositHoldUntil =
  // expectedEndDate + 3 days; Complete releases the obligation.
  depositAmount?: number;
  depositHoldUntil?: string;
  depositStatus?: 'none' | 'secured' | 'charged' | 'released';
  depositPaymentMethodId?: string;
  depositPaymentIntentId?: string;
  depositChargedAmount?: number;
  depositSecuredAt?: string;
  depositChargedAt?: string;
  depositChargeReason?: string;
  // Set on return: when the deposit obligation lapses (completedAt + 2 days).
  depositReleaseAt?: string;
  depositReleasedAt?: string;
  depositError?: string;
  // Rent-to-buy financing — priced at checkout, billed one period at a time after
  // delivery. See RentToBuyPlan / BillingSchedule.
  rentToBuyPlan?: RentToBuyPlan;
  billingSchedule?: BillingSchedule;
  rentToBuyOwned?: boolean;
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
  // Per-order chat unread flags. `customerUnreadMessage` is set by the
  // onProviderMessageSent function when FoodyzzHQ/the provider messages this
  // order, and cleared when the customer opens the order chat (mirror of
  // providerUnreadMessage on the provider side).
  customerUnreadMessage?: boolean;
  lastProviderMessageAt?: string;
  customerPhone: string;
  customerName: string;
  customerEmail?: string;
  customerAddress: string;
  status: OrderStatus;
  estimatedPrice: number;
  // Worst-case authorized hold (broadcast = max across in-range providers); preserved
  // through settlement so My Rentals can show the ceiling vs the actual charge.
  authorizedCeiling?: number;
  finalPrice?: number;
  providerId: string; // phoneNumber_zipCode or 'broadcast'
  providerName: string;
  createdAt: string;
  rating?: number;
  feedback?: string;
  ratedAt?: string;  // ISO timestamp when the customer submitted their rating
  // Post-delivery tip — charged on a separate payment intent after delivery; flat,
  // untaxed, commission-free, 100% provider-kept. Paid out independently of the
  // base order (see tipPayoutStatus) so a late tip is never double-paid.
  tip?: number;
  tipPaymentIntentId?: string;
  tipChargedAt?: string;
  tipChargeAvailableOn?: string;
  tipPayoutStatus?: 'unpaid' | 'paid';
  tipPayoutId?: string;
  tipDepositedAt?: string;
  // Two-part scheduling. handoff* = when the customer drops off / the provider picks
  // up; needBy* = when the customer needs it back. *Day is local YYYY-MM-DD, *Time is
  // a single label like "10:00 AM" (or a custom time). pickupDay/pickupTimeWindow are
  // kept and mirror the handoff pair for back-compat with provider date filtering.
  pickupDay?: string | null;
  pickupTimeWindow?: string | null;
  handoffDay?: string | null;
  handoffTime?: string | null;
  needByDay?: string | null;
  needByTime?: string | null;
  needBy: string; // ISO deadline = needByDay + needByTime
  notes?: string;
  paymentIntentId?: string;
  paymentCaptured?: boolean;
  providerLocation?: { lat: number; lng: number; timestamp: string; };
  providerCurrentStatus?: string;
  // Provider-payout lifecycle + money-audit fields (see functions/src/types.ts).
  payoutStatus?: 'unpaid' | 'paid';
  chargeAvailableOn?: string;
  authorizedAmount?: number;
  authorizedAt?: string;
  chargedAmount?: number;
  chargedAt?: string;
  depositedAmount?: number;
  depositedAt?: string;
  payoutId?: string;
  // Original estimate line items
  orderSubtotal?: number;
  deliveryFee?: number | null;
  tax?: number;
  taxRate?: number;
  ccProcessingFee?: number;
  // ISO timestamp written when the order is marked delivered/completed.
  completedAt?: string;
  couponCode?: string | null;
  couponDiscount?: number | null;
  platformFee?: number | null;
  referredByManagerId?: string | null;
  confirmedAt?: string;
  customerConfirmedAt?: string;
  adjustedSubtotal?: number;
  adjustedDeliveryFee?: number;
  adjustedTax?: number;
  adjustedProcessingFee?: number;
  // Optional note the provider attached to a price adjustment (shown with the
  // adjustment in order/transaction detail). Separate from the customer `notes`.
  adjustmentNote?: string | null;
  // Status to resume to once the customer approves a provider price adjustment
  // (set server-side in adjustOrderFinalPrice; usually 'confirmed').
  adjustmentResumeStatus?: OrderStatus;
}

export interface PromoCampaign {
  id: string;
  providerId: string;
  providerName: string;
  title?: string;
  price: number;
  text: string;
  expirationDate: string;
  viewsCounter: number;
  isActive: boolean;
  createdAt: string;
  offerCode?: string;
  discountType?: 'percentage' | 'amount';
  discountValue?: number;
  offerType?: 'rent' | 'rentToBuy' | 'buy';
  offerExpDate?: string;
  // Provider-defined reach: the promo is only shown to customers within this many
  // miles of the provider's address. Set in scrubsHQ PromosScreen ("Reach Radius").
  reachMiles?: number;
  providerZip?: string;
}

export interface GlobalConfig {
  commissionRate: number;
  commissionRates?: number;
  minimumCommission?: number;
  promoCostPerCount: number;
  maxPushBroadCastMile: number; // Default search radius (miles) for Explore
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
  };
  legal?: {
    tnc?: string;
    privacy?: string;
  };
  // Public support links surfaced on the account/profile screen.
  faq?: string;        // customer FAQ url (scrubsHQ uses hqfaq)
  hqfaq?: string;      // provider FAQ url
  contactus?: string;  // shared "contact us" url
  supportPhoneNumber: string;
}

export interface SupportMessage {
  id?: string;
  userPhone: string;
  userName: string;
  userRole: 'customer' | 'provider' | 'admin';
  senderPhone: string;
  senderName: string;
  text: string;
  timestamp: string;
  isReadByAdmin: boolean;
}

export interface Payout {
  id: string;
  providerId: string;
  providerName: string;
  amount: number;
  currency: string;
  transferId: string;
  status: 'pending' | 'paid' | 'failed';
  periodStart: string;
  periodEnd: string;
  createdAt: string;
  ordersIncluded: string[];
}

export interface MarketingInvoice {
  id: string;
  providerId: string;
  providerName: string;
  amount: number;
  currency: string;
  billedAt: string;
  promoCampaigns: any[];
  paymentStatus: 'pending' | 'paid' | 'failed';
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
// ── Foodyzz bike-rental domain ──────────────────────────────────────────────
// Mirrors functions/src/types.ts. All of the tables below are admin-editable and
// live in the single Firestore document `apiConfig/logistics`.

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

// How the customer takes the bike. Rent is billed per week, rent-to-buy per month,
// buy is a one-time price. Rent-to-buy and buy always start from NEW inventory.
export type RentalType = 'rent' | 'rentToBuy' | 'buy';

export type BikeCondition = 'new' | 'used';

export type BikeStatus = 'available' | 'reserved' | 'rented' | 'sold' | 'maintenance';

export interface BikeModelConfig {
  model: number;
  name: string;
  imageUrl: string;
  rates: { rent: number; buy: number; rentToBuy: number };
  // Minimum number of periods the customer must commit to. Buy has none.
  minCommitment: { rent: number; rentToBuy: number };
}

// `required` fees cannot be opted out of. The deposit (isDeposit) is disclosed to
// the customer but never billed on the rental invoice — it is secured separately.
export interface FeeConfig {
  key: string;
  label: string;
  amount: number;
  required: boolean;
  cadence: 'once' | 'weekly' | 'monthly';
  isDeposit?: boolean;
}

export interface LogisticsConfig {
  bikeModels: BikeModelConfig[];
  durationUnits: { rent: 'weeks'; rentToBuy: 'months' };
  inventory: Record<string, { new: number; used: number }>;
  fees: FeeConfig[];
  // Delivery window customers pick a slot from (appendix: 5pm–9pm).
  delivery: { startTime: string; endTime: string; slotMinutes: number };
  // Days after a bike's expected end date before it can be re-rented; drives the
  // "expected availability" date shown when a model is fully rented out.
  restockDays: number;
  // Flat admin fee charged when staff make the trip to collect a bike and the
  // customer isn't there. Billed on top of the renewed rental term.
  pickupFee?: number;
}

// bikes/{id} — one document per physical bike.
export interface Bike {
  id: string;
  model: number;
  bikeNo: number;
  condition: BikeCondition;
  status: BikeStatus;
  rentedBy?: string | null;
  rentedDate?: string | null;
  rentalDuration?: string | null;
  expectedEndDate?: string | null;
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
  cadence: 'once' | 'weekly' | 'monthly';
  accepted: boolean;
}

