// Money math for the Insights page. Pure functions over the settlement ledger and the
// order stream — no Firestore, no React — so the numbers on the page can be reasoned
// about (and tested) on their own.

import { Bike, RentalOrder, Settlement, SettlementKind, GlobalConfig, LogisticsConfig, OrderStatus } from '../../../types';

const round2 = (n: number): number => Math.round((n || 0) * 100) / 100;

export type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all';

export const RANGE_LABEL: Record<RangeKey, string> = {
  today: 'Today',
  '7d': '7 Days',
  '30d': '30 Days',
  '90d': '90 Days',
  all: 'All Time',
};

const RANGE_DAYS: Record<Exclude<RangeKey, 'today' | 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

// Local YYYY-MM-DD. Rental dates are stored as plain local day strings, so string
// comparison against this is both correct and timezone-safe.
export const todayDay = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const addDays = (day: string, n: number): string => {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** ISO instant a range starts at. `all` has no floor — the query falls back to a limit. */
export function rangeStartIso(range: RangeKey): string | null {
  if (range === 'all') return null;
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const d = new Date();
  d.setDate(d.getDate() - RANGE_DAYS[range]);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Transactions ────────────────────────────────────────────────────────────

export const KIND_LABEL: Record<SettlementKind, string> = {
  rental: 'Rental',
  deposit: 'Deposit',
  deposit_refund: 'Deposit refund',
  renewal: 'Renewal',
  installment: 'Installment',
  tip: 'Tip',
};

// Charges that are revenue. A deposit is the customer's money held in trust and its
// refund is that money going back, so neither belongs in a revenue total.
const REVENUE_KINDS: SettlementKind[] = ['rental', 'renewal', 'installment', 'tip'];

/**
 * A settlement with Stripe's side resolved. When the ledger has the real balance
 * transaction we use it; until then the fee is estimated from the configured Stripe
 * rates and the row is flagged, so an estimate is never passed off as settled fact.
 */
export interface Txn extends Settlement {
  stripeFeeResolved: number;
  stripeNetResolved: number;
  estimated: boolean;
  // What we billed the customer for card processing, minus what Stripe actually took.
  // Positive means the card fee we charge covers its cost; negative means it doesn't.
  spread: number;
  isRevenue: boolean;
}

export function resolveTxn(s: Settlement, config: GlobalConfig | null): Txn {
  const rate = Number(config?.stripe?.processingFee ?? 0.029);
  const flat = Number(config?.stripe?.transactionFee ?? 0.3);
  // Stripe charges its percentage + flat fee on money coming IN and keeps all of it
  // when money goes back out, so a refund carries no fee of its own.
  const estimated = s.stripeFee == null;
  const stripeFeeResolved = s.stripeFee ?? (s.amount > 0 ? s.amount * rate + flat : 0);
  const stripeNetResolved = s.stripeNet ?? s.amount - stripeFeeResolved;
  return {
    ...s,
    stripeFeeResolved,
    stripeNetResolved,
    estimated,
    spread: s.chargedCcFee - stripeFeeResolved,
    isRevenue: REVENUE_KINDS.includes(s.kind),
  };
}

// ── Card metrics ────────────────────────────────────────────────────────────

export interface MoneyMetrics {
  /** Gross collected on revenue transactions — deposits and refunds excluded. */
  revenueGross: number;
  /** The part of that we keep: no tax, no card fee. */
  revenueEarned: number;
  /** The fee-table portion (setup/insurance bundle, missed-collection admin fee). */
  feesCollected: number;
  /** The card-processing line item customers paid us. */
  ccFeesCollected: number;
  /** Sales tax collected — owed onward, never ours. */
  taxCollected: number;
  /** Gross moved through Stripe including deposits, net of refunds. */
  processed: number;
  txnCount: number;
  orderCount: number;
  /** What Stripe actually paid out: gross minus Stripe's own fees, refunds included. */
  stripePaid: number;
  /** What Stripe actually kept. */
  stripeFees: number;
  /** ccFeesCollected − stripeFees. Negative means card processing runs at a loss. */
  spread: number;
  /** Rows whose Stripe fee is still estimated rather than read from a balance txn. */
  estimatedCount: number;
}

export function computeMoneyMetrics(txns: Txn[]): MoneyMetrics {
  const m: MoneyMetrics = {
    revenueGross: 0, revenueEarned: 0, feesCollected: 0, ccFeesCollected: 0,
    taxCollected: 0, processed: 0, txnCount: txns.length, orderCount: 0,
    stripePaid: 0, stripeFees: 0, spread: 0, estimatedCount: 0,
  };
  const orderIds = new Set<string>();
  for (const t of txns) {
    orderIds.add(t.orderId);
    m.processed += t.amount;
    m.stripePaid += t.stripeNetResolved;
    m.stripeFees += t.stripeFeeResolved;
    m.ccFeesCollected += t.chargedCcFee;
    m.taxCollected += t.tax;
    m.feesCollected += t.serviceFees;
    if (t.isRevenue) {
      m.revenueGross += t.amount;
      m.revenueEarned += t.subtotal;
    }
    if (t.estimated) m.estimatedCount += 1;
  }
  m.orderCount = orderIds.size;
  m.spread = m.ccFeesCollected - m.stripeFees;
  return m;
}

/** The transactions behind one card, so a click can show its arithmetic. */
export function txnsForCard(txns: Txn[], card: MoneyCard): Txn[] {
  switch (card) {
    case 'revenue': return txns.filter(t => t.isRevenue);
    case 'fees': return txns.filter(t => t.serviceFees !== 0);
    case 'ccFees': return txns.filter(t => t.chargedCcFee !== 0);
    case 'tax': return txns.filter(t => t.tax !== 0);
    case 'volume': return txns;
    case 'stripePaid': return txns;
    case 'spread': return txns.filter(t => t.chargedCcFee !== 0 || t.stripeFeeResolved !== 0);
  }
}

export type MoneyCard = 'revenue' | 'fees' | 'ccFees' | 'tax' | 'volume' | 'stripePaid' | 'spread';

/** The transaction column a card is actually about, so its drilldown can point at it. */
export type TxnColumn = 'amount' | 'tax' | 'fees' | 'ccFee' | 'stripeNet' | 'spread';

export const CARD_COLUMN: Record<MoneyCard, TxnColumn> = {
  revenue: 'amount',
  fees: 'fees',
  ccFees: 'ccFee',
  tax: 'tax',
  volume: 'amount',
  stripePaid: 'stripeNet',
  spread: 'spread',
};

// ── Fee composition ─────────────────────────────────────────────────────────

/** One fee type across the drilled transactions — what actually makes up the total. */
export interface FeeComponent {
  label: string;
  amount: number;
  /** How many transactions carried this fee. */
  txns: number;
}

/**
 * Which fee keys ARE the deposit. The order's fee snapshot doesn't carry the isDeposit
 * flag, so it is read from the live config — exactly how the backend decides which fee
 * to leave out of `serviceFees` (see orderServiceFees).
 */
export const depositFeeKeys = (logistics: LogisticsConfig | null): Set<string> =>
  new Set((logistics?.fees || []).filter(f => f.isDeposit).map(f => String(f.key)));

/**
 * Break `feesCollected` down by fee type, so the headline resolves into the lines that
 * produced it. The ledger stores only a per-charge total, so the labels come from each
 * order's accepted-fee snapshot — what the customer actually agreed to at checkout.
 *
 * Anything the snapshot can't explain lands in a residual line rather than being
 * dropped: the components ALWAYS sum to the figure on the card. That residual is the
 * missed-collection admin fee on a renewal, which is billed on top of the fee table
 * and so appears in no order's fee list.
 */
export function feeBreakdown(
  txns: Txn[],
  ordersById: Map<string, RentalOrder>,
  depositKeys: Set<string>,
): FeeComponent[] {
  const byLabel = new Map<string, FeeComponent>();
  const add = (label: string, amount: number) => {
    const row = byLabel.get(label) ?? { label, amount: 0, txns: 0 };
    row.amount = round2(row.amount + amount);
    row.txns += 1;
    byLabel.set(label, row);
  };

  for (const t of txns) {
    if (!t.serviceFees) continue;
    const order = ordersById.get(t.orderId);
    // An installment or a renewal re-bills the recurring bundle only — the one-time
    // fees were settled on the original delivery charge and are never charged twice.
    const recurringOnly = t.kind === 'installment' || t.kind === 'renewal';
    const lines = (order?.fees || []).filter(
      f => f.accepted && !depositKeys.has(String(f.key)) && (!recurringOnly || f.cadence !== 'once'),
    );
    // A refund carries negative serviceFees; mirror the sign onto its components.
    const sign = t.serviceFees < 0 ? -1 : 1;

    let attributed = 0;
    for (const f of lines) {
      const amount = round2((Number(f.amount) || 0) * sign);
      if (!amount) continue;
      add(f.label || f.key, amount);
      attributed = round2(attributed + amount);
    }

    const residual = round2(t.serviceFees - attributed);
    if (Math.abs(residual) >= 0.01) {
      add(t.kind === 'renewal' ? 'Missed-collection admin fee' : 'Unitemised fees', residual);
    }
  }

  return Array.from(byLabel.values()).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}

// ── Program health ──────────────────────────────────────────────────────────

// A rental has physically gone out once its payment is captured — that is the moment
// the bike changes hands (see markRentalDelivered). Mirrors OperationsTab.
const isOut = (o: RentalOrder) =>
  o.paymentCaptured === true || [OrderStatus.DELIVERED, OrderStatus.COMPLETED].includes(o.status);

const isClosed = (o: RentalOrder) =>
  o.status === OrderStatus.CANCELLED || o.status === OrderStatus.COMPLETED || !!o.completedAt;

export interface HealthBuckets {
  /** Bikes physically out with a customer right now — the live book of business. */
  active: RentalOrder[];
  pendingDeliveries: RentalOrder[];
  /** Out on rent and coming back inside a week. */
  dueSoon: RentalOrder[];
  /** Out on rent, past the date it was due back. */
  overdue: RentalOrder[];
  /** Rent-to-buy plans whose card failed twice — a human has to step in. */
  installmentsPastDue: RentalOrder[];
  /** Deposits we are holding: the customer's money, owed back. */
  depositsHeld: RentalOrder[];
  /** Of those, the ones whose rental is already over — refund them now. */
  depositsRefundable: RentalOrder[];
}

export function computeHealth(orders: RentalOrder[], today = todayDay()): HealthBuckets {
  const weekOut = addDays(today, 7);
  const h: HealthBuckets = {
    active: [], pendingDeliveries: [], dueSoon: [], overdue: [],
    installmentsPastDue: [], depositsHeld: [], depositsRefundable: [],
  };
  for (const o of orders) {
    if (o.status !== OrderStatus.CANCELLED && !isOut(o)) h.pendingDeliveries.push(o);

    if (isOut(o) && !isClosed(o)) {
      h.active.push(o);
      if (o.expectedEndDate && o.expectedEndDate < today) h.overdue.push(o);
      else if (o.expectedEndDate && o.expectedEndDate <= weekOut) h.dueSoon.push(o);
    }

    if ((o as any).billingSchedule?.status === 'past_due') h.installmentsPastDue.push(o);

    // 'charged' is the only state where real money is sitting with us. 'secured' is the
    // legacy card-hold model (nothing was taken) and 'refunded' is already settled.
    if (o.depositStatus === 'charged' && Number(o.depositChargedAmount ?? 0) > 0) {
      h.depositsHeld.push(o);
      if (isClosed(o)) h.depositsRefundable.push(o);
    }
  }
  const byDue = (a: RentalOrder, b: RentalOrder) => (a.expectedEndDate || '').localeCompare(b.expectedEndDate || '');
  h.overdue.sort(byDue);
  h.dueSoon.sort(byDue);
  h.pendingDeliveries.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
  return h;
}

export const depositTotal = (orders: RentalOrder[]): number =>
  orders.reduce((s, o) => s + Number(o.depositChargedAmount ?? o.depositAmount ?? 0), 0);

// ── Fleet ───────────────────────────────────────────────────────────────────

export interface FleetCounts {
  available: number;
  reserved: number;
  rented: number;
  maintenance: number;
  sold: number;
  total: number;
}

export function computeFleet(bikes: Bike[]): FleetCounts {
  const f: FleetCounts = { available: 0, reserved: 0, rented: 0, maintenance: 0, sold: 0, total: bikes.length };
  for (const b of bikes) {
    if (b.status in f) (f as any)[b.status] += 1;
  }
  return f;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export const money = (n: number): string =>
  `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const shortDate = (iso: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' :
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};
