// Everything the rental flow needs to read out of `apiConfig/logistics` (the single
// admin-editable document holding the appendix tables) and out of the live `bikes`
// collection. Kept in one place so the customer wizard, the provider app and the
// Cloud Functions all quote the same dates, availability and prices.
import { db } from './firebase';
import type {
  Bike,
  BikeCondition,
  FeeConfig,
  LogisticsConfig,
  OrderFee,
  RentalType,
} from '../types';

// Fallback used only until an admin has seeded apiConfig/logistics (or while the
// first snapshot is in flight). Values match the project appendix.
export const DEFAULT_LOGISTICS: LogisticsConfig = {
  // The rent rate carries the Protection Plan waiver inside it — there is deliberately
  // no separate protection fee, so nothing on a bill is priced against the waiver.
  // NOTE when repricing: the base rate is charged PER PERIOD OF THE TERM (rate × weeks)
  // while the fee bundle is charged ONCE per rental. Folding a once-per-rental fee into
  // the weekly rate therefore multiplies it by the term — these rates spread the old
  // $9.99 across the 4-week minimum commitment so a standard rental costs what it did.
  bikeModels: [
    {
      model: 1,
      name: 'Foodyzz Model 1',
      imageUrl: '',
      rates: { rent: 22.49, buy: 899, rentToBuy: 69.99 },
      minCommitment: { rent: 4, rentToBuy: 12, rentCadence: 'weekly', rentToBuyCadence: 'monthly' },
      certification: {
        deviceStandard: 'UL 2849',
        batteryStandard: 'UL 2271',
        lab: 'TÜV Rheinland',
        deviceCertificateNumber: 'CU 726061660001',
        batteryCertificateNumber: 'CU 72303450 0003',
        verifyUrl: 'https://www.certipedia.com',
      },
    },
  ],
  durationUnits: { rent: 'weeks', rentToBuy: 'months' },
  inventory: { 1: { new: 10, used: 5 } },
  fees: [
    { key: 'deposit', label: 'Deposit', amount: 100, required: true, cadence: 'once', isDeposit: true },
    { key: 'maintenance', label: 'Maintenance', amount: 5.99, required: true, cadence: 'weekly' },
    { key: 'gpsTracker', label: 'GPS tracker', amount: 4.99, required: false, cadence: 'weekly' },
  ],
  delivery: { startTime: '17:00', endTime: '21:00', slotMinutes: 60 },
  restockDays: 2,
  pickupFee: 25,
};

export const subscribeToLogisticsConfig = (
  callback: (config: LogisticsConfig) => void,
) =>
  db.collection('apiConfig').doc('logistics').onSnapshot(
    (snap) => {
      if (snap.exists) callback({ ...DEFAULT_LOGISTICS, ...(snap.data() as LogisticsConfig) });
    },
    (err) => console.warn('subscribeToLogisticsConfig error:', err),
  );

// ── Dates ──────────────────────────────────────────────────────────────────
// All rental dates are plain local YYYY-MM-DD strings. `new Date('YYYY-MM-DD')`
// parses as UTC midnight and rolls back a day in western zones, so every helper
// here goes through parseDay/formatDay rather than the Date string constructor.

export const parseDay = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const formatDay = (date: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

export const addDays = (day: string, n: number): string => {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return formatDay(d);
};

export const todayDay = (): string => formatDay(new Date());

// The rental start date defaults to tomorrow (nothing is delivered same-day).
export const tomorrowDay = (): string => addDays(todayDay(), 1);

/**
 * Last day of a rental, counting the start date as day 1 — a 4-week rental that
 * starts 2026-07-22 ends 2026-08-18, exactly as in the appendix bike-history row.
 */
export const expectedEndDate = (
  startDate: string,
  value: number,
  unit: 'weeks' | 'months',
): string => {
  if (unit === 'weeks') return addDays(startDate, value * 7 - 1);
  const d = parseDay(startDate);
  d.setMonth(d.getMonth() + value);
  d.setDate(d.getDate() - 1);
  return formatDay(d);
};

// ── Delivery slots ─────────────────────────────────────────────────────────

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};

const label12h = (minutes: number): string => {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/**
 * Selectable delivery windows inside the configured band (appendix: 5pm–9pm),
 * e.g. ["5:00 PM – 6:00 PM", …, "8:00 PM – 9:00 PM"]. The last window ends
 * exactly at endTime; a partial trailing window is dropped rather than shown.
 */
export const deliverySlots = (config: LogisticsConfig): string[] => {
  const start = toMinutes(config.delivery?.startTime || '17:00');
  const end = toMinutes(config.delivery?.endTime || '21:00');
  const step = config.delivery?.slotMinutes || 60;
  const slots: string[] = [];
  for (let t = start; t + step <= end; t += step) {
    slots.push(`${label12h(t)} – ${label12h(t + step)}`);
  }
  return slots.length ? slots : [`${label12h(start)} – ${label12h(end)}`];
};

// ── Inventory / availability ───────────────────────────────────────────────

/**
 * Which bike conditions a rental type may draw from. Rent-to-buy and Buy always
 * start with a NEW bike; a plain rental may take either new or used stock.
 */
export const allowedConditions = (rentalType: RentalType): BikeCondition[] =>
  rentalType === 'rent' ? ['new', 'used'] : ['new'];

export const fetchBikes = async (): Promise<Bike[]> => {
  const snap = await db.collection('bikes').get();
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Bike[];
};

export interface ModelAvailability {
  model: number;
  available: number;
  // Per-condition counts, so the card can say "new" vs "used" where it matters.
  byCondition: Record<BikeCondition, number>;
  // Only set when `available` is 0: the soonest day a bike of this model can go
  // out again = earliest expected end date + restockDays.
  nextAvailableDate?: string;
}

/**
 * Availability for one model under one rental type, as of a requested start date.
 * A bike counts as available when it is free, or when its rental ends far enough
 * before the requested start that it can be turned around (expected end +
 * restockDays ≤ startDate). When nothing qualifies, the soonest such date is
 * returned so the wizard can show an "Expected availability" line instead of a
 * dead end.
 */
export const modelAvailability = (
  bikes: Bike[],
  config: LogisticsConfig,
  model: number,
  rentalType: RentalType,
  startDate: string,
): ModelAvailability => {
  const restock = config.restockDays ?? 2;
  const conditions = allowedConditions(rentalType);
  const pool = bikes.filter(
    (b) => b.model === model && conditions.includes(b.condition) && b.status !== 'sold' && b.status !== 'maintenance',
  );

  const byCondition: Record<BikeCondition, number> = { new: 0, used: 0 };
  const readyDates: string[] = [];

  for (const b of pool) {
    if (b.status === 'available') {
      byCondition[b.condition] += 1;
      continue;
    }
    // Rented or reserved: it frees up `restockDays` after its expected end date.
    const freeOn = b.expectedEndDate ? addDays(b.expectedEndDate, restock) : null;
    if (freeOn && freeOn <= startDate) byCondition[b.condition] += 1;
    else if (freeOn) readyDates.push(freeOn);
  }

  const available = byCondition.new + byCondition.used;
  return {
    model,
    available,
    byCondition,
    nextAvailableDate: available === 0 ? readyDates.sort()[0] : undefined,
  };
};

// ── Pricing ────────────────────────────────────────────────────────────────

export const rateFor = (
  config: LogisticsConfig,
  model: number,
  rentalType: RentalType,
): number => {
  const m = config.bikeModels.find((b) => b.model === model);
  if (!m) return 0;
  return m.rates[rentalType] ?? 0;
};

export const minCommitmentFor = (
  config: LogisticsConfig,
  model: number,
  rentalType: RentalType,
): { value: number; unit: 'weeks' | 'months' } | null => {
  if (rentalType === 'buy') return null;
  const m = config.bikeModels.find((b) => b.model === model);
  if (!m) return null;
  return {
    value: m.minCommitment[rentalType] ?? 0,
    unit: rentalType === 'rent' ? 'weeks' : 'months',
  };
};

/**
 * Fees to display for a rental type. Buy shows none at all (a purchase carries no
 * deposit, maintenance or tracker). Rent / Rent-to-Buy show every fee so the customer
 * is fully aware; `required: false` ones start OFF and are only charged once the
 * customer selects them, `required: true` ones are locked on and are part of the
 * quoted total. Pre-selecting an optional recurring charge is a consent problem, not
 * a default — so opting in is always an affirmative tap.
 */
export const feesFor = (config: LogisticsConfig, rentalType: RentalType): FeeConfig[] =>
  rentalType === 'buy' ? [] : config.fees || [];

export const toOrderFees = (fees: FeeConfig[], selectedKeys: string[]): OrderFee[] =>
  fees.map((f) => ({
    key: f.key,
    label: f.label,
    amount: f.amount,
    required: f.required,
    cadence: f.cadence,
    // The deposit is never a choice and is never rendered as a toggle, so it must not
    // fall through the opt-in branch and serialise as unaccepted just because a config
    // has it flagged `required: false`.
    accepted: f.required || f.isDeposit === true ? true : selectedKeys.includes(f.key),
  }));

export interface RentalQuote {
  baseRate: number;            // per-period rate, or the one-time buy price
  durationValue: number;       // 1 for a purchase
  durationUnit: 'weeks' | 'months';
  // Recurring fees the customer accepted, per period.
  recurringFees: number;
  // One-time fees the customer accepted, EXCLUDING the deposit.
  oneTimeFees: number;
  // Deposit is disclosed but never billed on this invoice — it is secured
  // separately against a saved card at delivery.
  depositAmount: number;
  // What the customer is charged for the whole committed term at delivery.
  total: number;
}

/**
 * The customer-facing quote. Deliberately excludes the deposit from `total`:
 * per the project spec the invoice must not include it.
 */
export const computeQuote = (
  config: LogisticsConfig,
  model: number,
  rentalType: RentalType,
  fees: OrderFee[],
  durationValue: number,
): RentalQuote => {
  const baseRate = rateFor(config, model, rentalType);
  const unit: 'weeks' | 'months' = rentalType === 'rentToBuy' ? 'months' : 'weeks';
  const periods = rentalType === 'buy' ? 1 : Math.max(1, durationValue);

  const accepted = fees.filter((f) => f.accepted && f.key !== 'deposit');
  const recurringFees = accepted
    .filter((f) => f.cadence !== 'once')
    .reduce((sum, f) => sum + f.amount, 0);
  const oneTimeFees = accepted
    .filter((f) => f.cadence === 'once')
    .reduce((sum, f) => sum + f.amount, 0);

  // A weekly fee on a month-denominated rent-to-buy term bills ~4.345 times a month.
  const feePeriods = unit === 'months' ? periods * (52 / 12) : periods;

  const deposit = (config.fees || []).find((f) => f.isDeposit)?.amount ?? 0;
  const total =
    rentalType === 'buy'
      ? baseRate
      : round2(baseRate * periods + recurringFees * feePeriods + oneTimeFees);

  return {
    baseRate,
    durationValue: periods,
    durationUnit: unit,
    recurringFees: round2(recurringFees),
    oneTimeFees: round2(oneTimeFees),
    depositAmount: rentalType === 'buy' ? 0 : deposit,
    total,
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;
