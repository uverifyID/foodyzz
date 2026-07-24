// This file is duplicated in each app for independence.
// In a monorepo, this would typically be a shared package.

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

export enum PriorityType {
  ASAP = 'ASAP',
  NORMAL = 'Normal',
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
  // Driver license / address proof on file. Can be scanned ahead of time from the
  // account profile, or captured right after FoodyzzHQ accepts an order — a repeat
  // customer with a reviewed license is never asked again.
  driverLicense?: DriverLicense;
  addressProof?: DriverLicense;
  preferredProviders: string[]; // Array of provider phone numbers
  blockedProviders: string[]; // Array of provider phone numbers
  stripeConfigured: boolean;
  isAdmin?: boolean; // For simulation purposes
  fcmToken?: string; // Firebase Cloud Messaging token
  isBlocked?: boolean; // Administrative block flag
}

export interface ProviderProfile {
  phoneNumber: string;
  zipCode: string;
  businessName: string;
  email: string;
  address: string;
  businessHours: {
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
  };
  // Bank details are no longer stored here — providers connect their bank directly
  // to Stripe (Connect). Only the payout cadence preference lives on the profile.
  payoutCadence?: 'standard' | 'daily';
  onboarded: boolean;
  onboardedAt?: string;
  // Sales tax the provider collects and remits themselves (decimal, e.g.
  // 0.08625). The platform only passes it through to the customer. 0 = no tax.
  chargesSalesTax?: boolean;
  salesTaxRate?: number;
  pickupEnabled?: boolean;
  // Master availability. Undefined/true = active; false = paused (no broadcasts,
  // hidden from customer search). Defaults to active for existing providers.
  servicesActive?: boolean;
  // Turnaround in whole DAYS (numeric). Legacy providers may still hold a free-form
  // string here; parse defensively (a non-numeric value = no structured turnaround).
  turnaroundNormal?: number | string;
  turnaroundPriority?: number | string;
  // Optional flat surcharge for an order that can only be met within the priority
  // (faster) window. chargesPriorityFee=false / priorityPrice=0 → no surcharge.
  chargesPriorityFee?: boolean;
  priorityPrice?: number | null;
  stripeAccountId?: string; // Stripe Connect Account ID for payouts
  fcmToken?: string; // Firebase Cloud Messaging token
  slotCapacity?: number; // Max concurrent orders per time slot
  isBlocked?: boolean; // Administrative block flag
  // Sales-rep referral attribution. Set once via the command-center referral
  // modal; the referring school manager earns commission on this fleet's orders.
  referredByManagerId?: string;
  referralCodeUsed?: string;
  referralCapturedAt?: string;
  referralPromptDismissed?: boolean; // one-time modal already shown/answered
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
  depositStatus?: 'none' | 'secured' | 'charged' | 'released' | 'refunded';
  depositPaymentMethodId?: string;
  depositPaymentIntentId?: string;
  depositChargedAmount?: number;
  depositSecuredAt?: string;
  depositChargedAt?: string;
  depositChargeReason?: string;
  // Damage/condition adjustments applied at return; subtracted from the deposit before
  // the balance is refunded to the customer.
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
  customerEmail: string;
  customerAddress: string;
  customerLat?: number | null;  // order anchor (pickup search coords or profile)
  customerLng?: number | null;
  needBy: string; // ISO string date = needByDay + needByTime
  isPickup: boolean;
  // Two-part scheduling. handoff* = drop-off / pickup; needBy* = when the customer
  // needs it back. *Day = local YYYY-MM-DD, *Time = single label ("10:00 AM").
  // pickupDay/pickupTimeWindow mirror the handoff pair for date-bucket filtering.
  pickupDay?: string;
  pickupTimeWindow?: string;
  handoffDay?: string | null;
  handoffTime?: string | null;
  needByDay?: string | null;
  needByTime?: string | null;
  notes?: string;
  status: OrderStatus;
  priority: PriorityType;
  // NOTE: customer charge/authorization fields (estimatedPrice, finalPrice,
  // authorizedCeiling, orderSubtotal, tax, …) are stripped from the providerOrders
  // mirror the scrubsHQ app reads — they are typed here for shared shape only and are
  // absent at runtime on the provider. Provider net pay derives from own pricing.
  estimatedPrice: number;
  authorizedCeiling?: number;
  finalPrice?: number; // Actual price after confirmation
  providerId: string; // phoneNumber_zipCode or 'broadcast'
  providerName: string;
  providerPhone: string;
  // Provider-payout lifecycle (see functions/src/types.ts). 'unpaid' until a Connect
  // transfer for this order completes. (Replaces the old overloaded depositStatus.)
  payoutStatus?: 'unpaid' | 'paid';
  chargeAvailableOn?: string; // when the captured charge settles (~3 days)
  depositedAt?: string;       // when this order was paid out
  payoutId?: string;
  depositedAmount?: number;   // provider net transferred for this order
  createdAt: string; // ISO string date
  // Persisted pricing breakdown (orderSubtotal is commission-inclusive).
  orderSubtotal?: number;
  platformFee?: number | null;
  deliveryFee?: number | null;
  tax?: number;
  taxRate?: number;
  ccProcessingFee?: number;
  adjustedSubtotal?: number; // commission-inclusive subtotal after provider adjustment
  adjustedDeliveryFee?: number;
  adjustedTax?: number;
  adjustedProcessingFee?: number;
  adjustmentNote?: string | null; // optional provider note sent to the customer with the adjustment
  customerConfirmedAt?: string; // ISO date when customer approved the adjustment
  paymentIntentId?: string; // Stripe PaymentIntent ID
  paymentCaptured?: boolean; // True if payment was captured
  paymentCanceled?: boolean; // True if payment was canceled
  paymentError?: string; // Error message if payment failed
  confirmedAt?: string; // ISO string date when order was confirmed
  completedAt?: string; // ISO string date when order was marked delivered/completed
  providerLocation?: { lat: number; lng: number; timestamp: string; }; // Provider's last known location
  providerCurrentStatus?: 'idle' | 'en_route_pickup' | 'at_pickup' | 'rental_active' | 'en_route_delivery' | 'at_delivery'; // More granular status
  expiryReason?: string; // Reason for cancellation if timed out
  couponCode?: string | null;
  couponDiscount?: number | null;
}

export interface PromoCampaign {
  id: string;
  providerId: string; // phoneNumber_zipCode
  providerName: string;
  providerZip: string;
  price: number; // Price per load for the promo
  text: string; // Promo offer text
  monthsActive: number;
  expirationDate: string; // YYYY-MM-DD
  viewsCounter: number;
  isActive: boolean;
  cardNameOnInvoice: string;
  createdAt: string; // ISO string date
  deactivatedAt?: string; // ISO string date when promo was deactivated
}

export interface GlobalConfig {
  commissionRate: number;
  promoCostPerCount: number;
  maxPushBroadCastMile: number;
  stripe: {
    merchantId: string;
    publishableKey: string;
    secretKey: string;
    webSecret?: string; // Stripe Webhook Secret
    transactionFee: number; // Added for consistency with functions
    processingFee: number; // Added for consistency with functions
    dailyPayoutFee?: number; // per-transfer fee for the daily payout cadence
  };
  deliveryFee: { // Added for consistency with functions
    radius: number;
    pickupDelivery: number;
  };
  apiKeys: { // Added for consistency with functions
    googleMap: string;
  };
  legal?: {
    tnc?: string;
    privacy?: string;
  };
  supportPhoneNumber: string;
}

export interface ChatMessage {
  id: string;
  orderId: string;
  senderRole: AppRole;
  senderPhone: string;
  text: string;
  timestamp: string; // ISO string date
}

export interface SupportMessage {
  id?: string;
  userPhone: string; // The phone number of the user (customer or provider) who initiated the support thread
  userName: string;
  userRole: 'customer' | 'provider' | 'admin';
  senderPhone: string; // The phone number of the sender (can be user or admin)
  senderName: string;
  text: string;
  timestamp: string; // ISO string date
  isReadByAdmin: boolean;
  adminNotifiedOfUnread?: boolean; // Added for tracking unread notifications
}

export interface Payout {
  id: string;
  providerId: string; // phoneNumber_zipCode
  providerName: string;
  amount: number; // Net amount transferred to provider
  currency: string;
  transferId: string; // Stripe Transfer ID
  status: 'pending' | 'paid' | 'failed';
  periodStart: string; // ISO date of the start of the payout period
  periodEnd: string;   // ISO date of the end of the payout period
  createdAt: string;   // ISO date of when the payout was initiated
  ordersIncluded: string[]; // Array of order IDs included in this payout
}

export interface MarketingInvoice {
  id: string;
  providerId: string; // phoneNumber_zipCode
  providerName: string;
  amount: number; // Total amount billed for promo views
  currency: string;
  billedAt: string; // ISO date of when the invoice was generated
  promoCampaigns: { promoId: string; views: number; costPerView: number; billedAmount: number; }[];
  paymentStatus: 'pending' | 'paid' | 'failed';
}

export interface DailyStats {
  date: string;
  totalRevenue: number;
  totalCommission: number;
  orderCount: number;
  cancelledCount: number;
  updatedAt: string;
}

export interface ProviderPerformance {
  providerId: string;
  businessName: string;
  totalRevenue: number;
  ordersCompleted: number;
  completionRate: number; // percentage
  lastOrderAt: string;
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

