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
  // Driver license / address proof on file. Can be scanned ahead of time from the
  // account profile, or captured right after FoodyzzHQ accepts an order — a repeat
  // customer with a reviewed license is never asked again.
  driverLicense?: DriverLicense;
  addressProof?: DriverLicense;
  isBlocked?: boolean;
  fcmToken?: string;
  isAdmin?: boolean;
}

export interface ProviderProfile {
  // Firestore doc id `${phone}_${storeIdentifier}`. Always prefer this over
  // reconstructing from phone+zipCode — the service zip is no longer the suffix.
  id?: string;
  phoneNumber: string;
  zipCode: string;
  businessName: string;
  email: string;
  address: string;
  onboarded: boolean;
  isBlocked?: boolean;
  fcmToken?: string;
  slotCapacity?: number;
  // Master availability. Undefined/true = active; false = paused.
  servicesActive?: boolean;
  // Sales-rep referral attribution (the provider's referrer earns commission).
  referralCapturedAt?: string;
  referralPromptDismissed?: boolean;
}

// Append-only audit entry for every change to the customer's charged amount.
export interface AdjustmentEntry {
  at: string;
  by: 'provider' | 'system' | 'customer';
  reason: string;
  fromAmount: number;
  toAmount: number;
  paymentIntentId?: string;
}

export interface RentalOrder {
  id: string;
  // ── Bike rental (Foodyzz) ────────────────────────────────────────────────
  rentalType?: RentalType;
  bikeModel?: number;
  bikeId?: string | null;            // assigned at delivery, not at order time
  // Placed while every free bike of this model was already claimed by an earlier
  // order. HQ must confirm it can be fulfilled before assigning a bike.
  waitlisted?: boolean;
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
  depositStatus?: 'none' | 'secured' | 'charged' | 'released' | 'refunded';
  depositPaymentMethodId?: string;
  depositPaymentIntentId?: string;
  depositChargedAmount?: number;
  depositSecuredAt?: string;
  depositChargedAt?: string;
  depositChargeReason?: string;
  // Damage adjustments applied at return; subtracted from the deposit before the balance
  // is refunded.
  depositAdjustments?: { note: string; amount: number }[];
  depositAdjustmentTotal?: number;
  depositRefundedAmount?: number;
  depositRefundId?: string;
  depositRefundedAt?: string;
  // Set on return: when the deposit obligation lapses (completedAt + 2 days). Legacy.
  depositReleaseAt?: string;
  depositReleasedAt?: string;
  depositError?: string;
  // Condition recorded when the bike comes back, to compare against handover.
  conditionAtReturn?: BikeConditionReport;
  // Bike condition recorded at handover — notes + photos, visible to both sides.
  conditionAtDelivery?: BikeConditionReport;
  // Stamped when FoodyzzHQ verifies BOTH documents; gates Ready for Delivery.
  docsVerifiedAt?: string;
  idRequestedAt?: string;
  readyForDeliveryAt?: string;
  customerPhone: string;
  customerName: string;
  customerEmail?: string;
  customerAddress: string;
  status: OrderStatus;
  estimatedPrice: number;
  finalPrice?: number;
  providerId: string; // phoneNumber_zipCode or 'broadcast'
  providerName: string;
  createdAt: string;
  rating?: number;
  feedback?: string;
  pickupDay?: string | null;
  pickupTimeWindow?: string | null;
  needBy: string;
  notes?: string;
  paymentIntentId?: string;
  paymentCaptured?: boolean;
  providerLocation?: { lat: number; lng: number; timestamp: string; };
  providerCurrentStatus?: string;
  couponCode?: string | null;
  couponDiscount?: number | null;
  // The promos/{id} the code came from. onOrderCreatedRedeemPromo uses it to confirm
  // the redemption claim, so the code can't be spent a second time.
  couponPromoId?: string | null;
  // Persisted pricing breakdown (commission-inclusive subtotal; taxRate is the
  // provider's rate actually applied).
  orderSubtotal?: number;
  adjustedSubtotal?: number;
  platformFee?: number | null;
  deliveryFee?: number | null;
  tax?: number;
  taxRate?: number;
  ccProcessingFee?: number;
  authorizedCeiling?: number;

  // ── Money audit trail (see functions/src/types.ts) ──
  chargeAvailableOn?: string;     // settlement date (~3 days after capture)
  authorizedAmount?: number;
  authorizedAt?: string;
  chargedAmount?: number;
  chargedAt?: string;
  // ISO timestamp written when the rental is marked delivered/completed.
  completedAt?: string;
  adjustments?: AdjustmentEntry[];
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
  createdAt: string;
}

// Platform-wide settings. Bike rates, fees, inventory and the delivery window all
// live in the separate `apiConfig/logistics` document (see LogisticsConfig).
export interface GlobalConfig {
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
    // Named to match what the backend reads (config.stripe.webSecret).
    webSecret?: string;
    transactionFee: number;
    processingFee: number;
  };
  supportPhoneNumber: string;
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

// ── Settlement ledger (settlements/{stripeId}) ──────────────────────────────
// Mirrors functions/src/types.ts. One document per money movement through Stripe.
// Orders record what the customer agreed to pay; this records what actually moved and
// what Stripe kept for moving it — the spread between `chargedCcFee` and `stripeFee`
// is the platform's margin on card processing. Admin-read, server-written.
export type SettlementKind =
  | 'rental'
  | 'deposit'
  | 'deposit_refund'
  | 'renewal'
  | 'installment'
  | 'tip';

export interface Settlement {
  id: string;
  orderId: string;
  kind: SettlementKind;
  at: string;
  // Signed gross: charges positive, refunds negative.
  amount: number;
  subtotal: number;
  tax: number;
  chargedCcFee: number;
  serviceFees: number;
  // null until Stripe's balance transaction is readable — syncStripeSettlements
  // backfills those, and the UI estimates from config in the meantime.
  stripeFee: number | null;
  stripeNet: number | null;
  availableOn: string | null;
  currency: string;
  customerPhone: string;
  customerName: string;
  providerId: string;
  providerName: string;
  updatedAt: string;
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
  // rentToBuyCadence controls how often installments bill. 'monthly' is production;
  // 'daily'/'weekly' exist only to exercise a plan end-to-end without waiting months.
  // Mirrors LogisticsDoc in functions/src/index.ts, which is authoritative.
  minCommitment: {
    rent: number;
    rentToBuy: number;
    rentCadence?: 'daily' | 'weekly' | 'monthly';
    rentToBuyCadence?: 'daily' | 'weekly' | 'monthly';
  };
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

