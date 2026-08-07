import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  DollarSign, ShoppingBag, Sparkles, Activity, Receipt, CreditCard, Landmark,
  PiggyBank, Scale, Truck, CalendarClock, AlertTriangle, RefreshCw, Bike as BikeIcon, AlertCircle,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  DailyStats, ProviderPerformance, RentalOrder, Settlement, GlobalConfig, LogisticsConfig, Bike,
} from '../../types';
import StatCard from './StatCard';
import DetailModal from './insights/DetailModal';
import {
  RangeKey, RANGE_LABEL, Txn, MoneyCard, CARD_COLUMN, computeFleet, computeHealth, computeMoneyMetrics,
  depositFeeKeys, depositTotal, feeBreakdown, money, rangeStartIso, resolveTxn, txnsForCard, todayDay,
} from './insights/ledger';
import { db, callable } from '../../firebase';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';

interface AnalyticsTabProps {
  dailyStats: DailyStats[];
  providerPerf: ProviderPerformance[];
  ordersCount: number;
  orders: RentalOrder[];
  config: GlobalConfig | null;
  logistics: LogisticsConfig | null;
}

// 'All time' has no lower bound, so it is capped instead. Well above any plausible
// transaction count today, and a hard stop on the read either way.
const ALL_TIME_CAP = 2000;

// Which drilldown is open. Money cards resolve to a transaction list, health cards to
// an order list.
type Drill =
  | { type: 'money'; card: MoneyCard }
  | { type: 'orders'; key: keyof ReturnType<typeof computeHealth> };

const HEALTH_TITLE: Record<string, string> = {
  pendingDeliveries: 'Pending deliveries',
  dueSoon: 'Due back within 7 days',
  overdue: 'Overdue rentals',
  installmentsPastDue: 'Rent-to-buy plans past due',
  depositsHeld: 'Deposits currently held',
  depositsRefundable: 'Deposits ready to refund',
};

export default function AnalyticsTab({ dailyStats, providerPerf, ordersCount, orders, config, logistics }: AnalyticsTabProps) {
  const [range, setRange] = useState<RangeKey>('30d');
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  // The ledger read is scoped to the selected range, so switching the filter re-queries
  // rather than pulling every settlement the platform has ever written. `at` is a plain
  // ISO string, so this is a single-field range query — no composite index needed.
  useEffect(() => {
    setLedgerLoading(true);
    setLedgerError(null);
    const from = rangeStartIso(range);
    const q = from
      ? query(collection(db, 'settlements'), where('at', '>=', from), orderBy('at', 'desc'))
      : query(collection(db, 'settlements'), orderBy('at', 'desc'), limit(ALL_TIME_CAP));
    return onSnapshot(
      q,
      snap => {
        setSettlements(snap.docs.map(d => ({ ...(d.data() as Settlement), id: d.id })));
        setLedgerLoading(false);
      },
      e => {
        console.error('settlements listener failed:', e);
        setLedgerError(e.message);
        setLedgerLoading(false);
      },
    );
  }, [range]);

  useEffect(() => {
    return onSnapshot(
      collection(db, 'bikes'),
      snap => setBikes(snap.docs.map(d => ({ ...(d.data() as Bike), id: d.id }))),
      e => console.error('bikes listener failed:', e),
    );
  }, []);

  const txns = useMemo(() => settlements.map(s => resolveTxn(s, config)), [settlements, config]);
  const metrics = useMemo(() => computeMoneyMetrics(txns), [txns]);
  // Program health is a snapshot of where the program stands right now, not a flow
  // through the selected window — an overdue bike is overdue whatever range is picked.
  const health = useMemo(() => computeHealth(orders), [orders]);
  const fleet = useMemo(() => computeFleet(bikes), [bikes]);
  const depositsHeldTotal = useMemo(() => depositTotal(health.depositsHeld), [health.depositsHeld]);
  const depositsRefundableTotal = useMemo(() => depositTotal(health.depositsRefundable), [health.depositsRefundable]);

  // Charged vs actually-paid, per day. Answers the reconciliation question at a glance:
  // the gap between the two bars is everything Stripe kept.
  const trend = useMemo(() => {
    const byDay: Record<string, { day: string; charged: number; stripePaid: number; stripeFee: number }> = {};
    for (const t of txns) {
      const day = (t.at || '').split('T')[0];
      if (!day) continue;
      if (!byDay[day]) byDay[day] = { day, charged: 0, stripePaid: 0, stripeFee: 0 };
      byDay[day].charged += t.amount;
      byDay[day].stripePaid += t.stripeNetResolved;
      byDay[day].stripeFee += t.stripeFeeResolved;
    }
    return Object.values(byDay)
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-30)
      .map(d => ({
        ...d,
        charged: Math.round(d.charged * 100) / 100,
        stripePaid: Math.round(d.stripePaid * 100) / 100,
        label: new Date(d.day + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }));
  }, [txns]);

  const satisfaction = useMemo(() => {
    const totals = dailyStats.reduce(
      (acc, d) => ({ sum: acc.sum + (d.ratingSum || 0), count: acc.count + (d.ratedCount || 0) }),
      { sum: 0, count: 0 },
    );
    return totals.count > 0 ? totals.sum / totals.count : null;
  }, [dailyStats]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncNote(null);
    try {
      // One bounded page per click. The result reports whether more orders remain, so a
      // large backfill is the admin clicking again rather than one unbounded job.
      const res: any = await callable('syncStripeSettlements')({ maxOrders: 150, maxFees: 150 });
      const d = res?.data ?? {};
      setSyncNote(
        `Scanned ${d.ordersScanned ?? 0} orders · found ${d.candidates ?? 0} transaction(s) · ` +
        `${d.backfilled ?? 0} added · ${d.feesFilled ?? 0} Stripe fee(s) settled` +
        (d.failed ? ` · ${d.failed} FAILED to write (check function logs)` : '') +
        (d.nextCursor ? ' · more orders remain, sync again' : ''),
      );
    } catch (e: any) {
      setSyncNote(e?.message || 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  }, []);

  const rangeLabel = RANGE_LABEL[range].toLowerCase();

  // The rows behind the open money drilldown, and — for Fees Collected — the fee types
  // that make them up. The ledger stores one fee total per charge, so the itemisation is
  // joined from each order's accepted-fee snapshot; `orders` is the whole collection, so
  // nothing is missed. Both are null unless a money card is open, so a closed modal
  // costs nothing.
  const drillTxns = useMemo(
    () => (drill?.type === 'money' ? txnsForCard(txns, drill.card) : []),
    [drill, txns],
  );

  const ordersById = useMemo(() => new Map(orders.map(o => [o.id, o])), [orders]);

  const drillFeeBreakdown = useMemo(
    () => (drill?.type === 'money' && drill.card === 'fees'
      ? feeBreakdown(drillTxns, ordersById, depositFeeKeys(logistics))
      : undefined),
    [drill, drillTxns, ordersById, logistics],
  );

  return (
    <div className="space-y-8">
      <header className="mb-8 flex flex-col lg:flex-row justify-between items-start lg:items-end gap-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter italic">Insights & Revenue</h2>
          <p className="text-stone-500 text-sm font-bold uppercase font-mono">Program health, money in and money kept</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 bg-stone-200 p-1 border-2 border-black shadow-brutalist">
            {(Object.keys(RANGE_LABEL) as RangeKey[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-2 font-black uppercase text-[10px] tracking-widest transition-all ${
                  range === r ? 'bg-black text-white' : 'text-stone-500 hover:bg-stone-300'
                }`}
              >
                {RANGE_LABEL[r]}
              </button>
            ))}
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            title="Read the real fee Stripe took on each transaction, and backfill any charge missing from the ledger"
            className="flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-black shadow-brutalist font-black uppercase text-[10px] tracking-widest hover:bg-stone-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing' : 'Sync Stripe'}
          </button>
        </div>
      </header>

      {syncNote && (
        <p className="text-[10px] font-bold font-mono uppercase text-stone-600 bg-stone-100 border-2 border-black px-4 py-2">
          {syncNote}
        </p>
      )}

      {ledgerError && (
        <div className="flex items-center gap-3 bg-rose-50 border-4 border-rose-400 px-4 py-3">
          <AlertCircle size={16} className="text-rose-600 shrink-0" />
          <p className="text-xs font-bold font-mono text-rose-800">Settlement ledger unreadable: {ledgerError}</p>
        </div>
      )}

      {!ledgerLoading && !ledgerError && settlements.length === 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border-4 border-yellow-400 px-4 py-3 shadow-[4px_4px_0px_0px_rgba(250,204,21,1)]">
          <AlertCircle size={16} className="text-yellow-600 shrink-0" />
          <p className="text-xs font-bold font-mono text-yellow-800">
            No settled transactions in this range. Charges taken before the settlement ledger existed need one
            Sync Stripe pass to appear here.
          </p>
        </div>
      )}

      {metrics.estimatedCount > 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border-4 border-yellow-400 px-4 py-3 shadow-[4px_4px_0px_0px_rgba(250,204,21,1)]">
          <AlertCircle size={16} className="text-yellow-600 shrink-0" />
          <p className="text-xs font-bold font-mono text-yellow-800">
            {metrics.estimatedCount} of {metrics.txnCount} transactions have no Stripe fee on record yet — those rows
            estimate it from the configured rate ({((config?.stripe?.processingFee ?? 0.029) * 100).toFixed(2)}% +{' '}
            {money(config?.stripe?.transactionFee ?? 0.3)}). Sync Stripe to replace them with what Stripe actually took.
          </p>
        </div>
      )}

      {/* ── Money ─────────────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[10px] font-black uppercase text-brand-green-dark mb-4 tracking-[0.2em] flex items-center gap-2">
          <Activity size={14} /> {rangeLabel} · money · click any card for its transactions
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard
            title="Total Revenue"
            value={money(metrics.revenueGross)}
            sub={`${money(metrics.revenueEarned)} after tax & card fees`}
            icon={<DollarSign />}
            color="bg-emerald-100"
            onClick={() => setDrill({ type: 'money', card: 'revenue' })}
          />
          <StatCard
            title="Fees Collected"
            value={money(metrics.feesCollected)}
            sub="Fee bundle + admin fees"
            icon={<Receipt />}
            color="bg-brand-green/10"
            onClick={() => setDrill({ type: 'money', card: 'fees' })}
          />
          <StatCard
            title="Card Processing Collected"
            value={money(metrics.ccFeesCollected)}
            sub={`Stripe kept ${money(metrics.stripeFees)}`}
            icon={<CreditCard />}
            color="bg-indigo-100"
            onClick={() => setDrill({ type: 'money', card: 'ccFees' })}
          />
          <StatCard
            title="Volume"
            value={`${metrics.txnCount}`}
            // Counted from the live order stream, not stats/platformCounts — that
            // rollup drifts from the collection it summarises.
            trend={`${health.active.length} out now`}
            sub={`${metrics.orderCount} orders · ${money(metrics.processed)} processed`}
            icon={<ShoppingBag />}
            color="bg-white"
            onClick={() => setDrill({ type: 'money', card: 'volume' })}
          />
          <StatCard
            title="Tax Collected"
            value={money(metrics.taxCollected)}
            sub="Owed onward — never ours"
            icon={<Landmark />}
            color="bg-amber-100"
            onClick={() => setDrill({ type: 'money', card: 'tax' })}
          />
          <StatCard
            title="Deposits To Refund"
            value={money(depositsHeldTotal)}
            trend="Current"
            sub={`${health.depositsHeld.length} held · ${health.depositsRefundable.length} due back now · ignores the date filter`}
            icon={<PiggyBank />}
            color="bg-rose-100"
            onClick={() => setDrill({ type: 'orders', key: 'depositsHeld' })}
          />
          <StatCard
            title="Paid Out By Stripe"
            value={money(metrics.stripePaid)}
            sub={`${money(metrics.processed)} processed − ${money(metrics.stripeFees)} in Stripe fees`}
            icon={<Landmark />}
            color="bg-white"
            onClick={() => setDrill({ type: 'money', card: 'stripePaid' })}
          />
          <StatCard
            title="Card Fee Spread"
            value={`${metrics.spread >= 0 ? '+' : ''}${money(metrics.spread)}`}
            sub={`We charged ${money(metrics.ccFeesCollected)}, Stripe took ${money(metrics.stripeFees)}`}
            icon={<Scale />}
            color={metrics.spread < 0 ? 'bg-rose-100' : 'bg-emerald-100'}
            onClick={() => setDrill({ type: 'money', card: 'spread' })}
          />
        </div>
      </section>

      {/* ── Program health ────────────────────────────────────────────────── */}
      <section>
        <h3 className="text-[10px] font-black uppercase text-brand-green-dark mb-4 tracking-[0.2em] flex items-center gap-2">
          <Activity size={14} /> right now · operations
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          <StatCard
            title="Pending Deliveries"
            value={`${health.pendingDeliveries.length}`}
            sub="Ordered, not yet handed over"
            icon={<Truck />}
            color="bg-indigo-100"
            onClick={() => setDrill({ type: 'orders', key: 'pendingDeliveries' })}
          />
          <StatCard
            title="Rentals Due (7 Days)"
            value={`${health.dueSoon.length}`}
            sub="Coming back this week"
            icon={<CalendarClock />}
            color="bg-amber-100"
            onClick={() => setDrill({ type: 'orders', key: 'dueSoon' })}
          />
          <StatCard
            title="Overdue"
            value={`${health.overdue.length}`}
            sub="Past due-back date, still out"
            icon={<AlertTriangle />}
            color={health.overdue.length > 0 ? 'bg-rose-100' : 'bg-white'}
            onClick={() => setDrill({ type: 'orders', key: 'overdue' })}
          />
          <StatCard
            title="Plans Past Due"
            value={`${health.installmentsPastDue.length}`}
            sub="Rent-to-buy card failed twice"
            icon={<AlertTriangle />}
            color={health.installmentsPastDue.length > 0 ? 'bg-rose-100' : 'bg-white'}
            onClick={() => setDrill({ type: 'orders', key: 'installmentsPastDue' })}
          />
        </div>
      </section>

      {/* ── Fleet ─────────────────────────────────────────────────────────── */}
      <section className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
          <h3 className="text-lg font-black uppercase flex items-center gap-2 italic">
            <BikeIcon size={20} className="text-brand-green-dark" /> Fleet Inventory
          </h3>
          <div className="flex flex-wrap items-center gap-4 text-[10px] font-mono font-bold uppercase text-stone-500">
            <span>{fleet.total} bikes on the books</span>
            <span>{money(depositsRefundableTotal)} refundable today</span>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {([
            ['Available', fleet.available, 'bg-emerald-100'],
            ['Reserved', fleet.reserved, 'bg-amber-100'],
            ['Rented', fleet.rented, 'bg-brand-green/20'],
            ['Maintenance', fleet.maintenance, 'bg-rose-100'],
            ['Sold', fleet.sold, 'bg-stone-200'],
          ] as const).map(([label, count, color]) => (
            <div key={label} className={`${color} border-2 border-black p-4`}>
              <p className="text-[9px] font-black uppercase text-stone-600 tracking-widest">{label}</p>
              <p className="text-2xl font-black font-mono tracking-tighter">{count}</p>
            </div>
          ))}
        </div>
        {logistics && (
          <p className="text-[10px] font-mono font-bold uppercase text-stone-400 mt-4">
            {logistics.bikeModels.length} model{logistics.bikeModels.length === 1 ? '' : 's'} configured ·
            restock window {logistics.restockDays ?? 0} day{logistics.restockDays === 1 ? '' : 's'}
          </p>
        )}
      </section>

      {/* ── Charged vs paid ───────────────────────────────────────────────── */}
      <section className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
          <h3 className="text-lg font-black uppercase flex items-center gap-2 italic">
            <Scale size={20} className="text-brand-green-dark" /> What We Charged vs What Stripe Paid
          </h3>
          <p className="text-[10px] font-mono font-bold uppercase text-stone-400">
            Last 30 days with activity · the gap is Stripe's cut
          </p>
        </div>
        {trend.length === 0 ? (
          <p className="text-stone-400 font-mono text-xs text-center py-16">No transactions to chart in this range.</p>
        ) : (
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f0f0f0" />
                <XAxis
                  dataKey="label"
                  axisLine={{ stroke: '#000', strokeWidth: 2 }}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }}
                  dy={8}
                />
                <YAxis
                  axisLine={{ stroke: '#000', strokeWidth: 2 }}
                  tickLine={false}
                  tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }}
                  tickFormatter={v => `$${v}`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(0,0,0,0.04)' }}
                  contentStyle={{ backgroundColor: '#fff', border: '4px solid #000', borderRadius: '0px', boxShadow: '4px 4px 0px 0px #000', fontFamily: 'JetBrains Mono' }}
                  labelStyle={{ fontWeight: '900', marginBottom: '4px', textTransform: 'uppercase' }}
                  formatter={(v: any, name: string) => [money(Number(v)), name]}
                />
                <Legend wrapperStyle={{ fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }} />
                <Bar dataKey="charged" name="We charged" fill="#507425" stroke="#000" strokeWidth={2} />
                <Bar dataKey="stripePaid" name="Stripe paid" fill="#c7d9a8" stroke="#000" strokeWidth={2} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* ── Per-transaction reconciliation ────────────────────────────────── */}
      <section className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-3">
          <h3 className="text-lg font-black uppercase italic">Transactions · {rangeLabel}</h3>
          <p className="text-[10px] font-mono font-bold uppercase text-stone-400">
            What we charged, what Stripe took, and the difference on each
          </p>
        </div>
        <TransactionPreview txns={txns} onOpenAll={() => setDrill({ type: 'money', card: 'volume' })} />
      </section>

      {/* ── Stores ────────────────────────────────────────────────────────── */}
      <section className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <h3 className="text-lg font-black uppercase italic">Store Performance</h3>
          <div className="flex items-center gap-4 text-[10px] font-mono font-bold text-stone-400 uppercase">
            {satisfaction != null && (
              <span className="flex items-center gap-1 text-yellow-600">
                <Sparkles size={12} /> {satisfaction.toFixed(1)} / 5 satisfaction
              </span>
            )}
            <span>Lifetime revenue: {money(providerPerf.reduce((s, p) => s + (p.totalRevenue || 0), 0))}</span>
          </div>
        </div>
        {providerPerf.length === 0 ? (
          <p className="text-stone-400 font-mono text-xs text-center py-8">No store data yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full min-w-[480px] text-left">
              <thead>
                <tr className="border-b-2 border-stone-100 text-[10px] font-black uppercase text-stone-400">
                  <th className="pb-4">Store</th>
                  <th className="pb-4">Orders</th>
                  <th className="pb-4">Completion</th>
                  <th className="pb-4">Rating</th>
                  <th className="pb-4 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-50">
                {[...providerPerf].sort((a, b) => b.totalRevenue - a.totalRevenue).map(p => (
                  <tr key={p.providerId}>
                    <td className="py-4 font-black uppercase text-xs">{p.businessName}</td>
                    <td className="py-4 font-mono text-xs">{p.ordersCompleted}</td>
                    <td className="py-4">
                      <div className="w-16 h-2 bg-stone-100 rounded-full overflow-hidden border border-black/5">
                        <div className="bg-emerald-400 h-full" style={{ width: `${Math.min(100, p.completionRate)}%` }} />
                      </div>
                    </td>
                    <td className="py-4 font-bold text-xs text-yellow-600">⭐ {p.avgRating?.toFixed(1) || '5.0'}</td>
                    <td className="py-4 text-right font-black text-sm">{money(p.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {drill?.type === 'money' && (
        <DetailModal
          title={MONEY_DRILL[drill.card].title}
          // Subtitle counts describe the ROWS the modal shows, not every transaction in
          // the range — "across 6 transactions" over a 2-row table is just wrong.
          subtitle={MONEY_DRILL[drill.card].subtitle(metrics, drillTxns)}
          note={MONEY_DRILL[drill.card].note}
          txns={drillTxns}
          highlight={CARD_COLUMN[drill.card]}
          breakdown={drill.card === 'fees' ? drillFeeBreakdown : undefined}
          onClose={() => setDrill(null)}
        />
      )}
      {drill?.type === 'orders' && (
        <DetailModal
          title={HEALTH_TITLE[drill.key]}
          subtitle={
            drill.key === 'depositsHeld'
              ? `${money(depositsHeldTotal)} held across ${health.depositsHeld.length} rental(s) · ${money(depositsRefundableTotal)} refundable now`
              : `${health[drill.key].length} rental(s) · as of ${todayDay()}`
          }
          orders={health[drill.key]}
          onClose={() => setDrill(null)}
        />
      )}
    </div>
  );
}

// Headline + one-line arithmetic for each money drilldown, so the modal explains what
// the card counted rather than just listing rows. `rows` is what the modal actually
// shows — any count in a subtitle must come from it, never from the range-wide totals.
const MONEY_DRILL: Record<MoneyCard, {
  title: string;
  subtitle: (m: ReturnType<typeof computeMoneyMetrics>, rows: Txn[]) => string;
  note: string;
}> = {
  revenue: {
    title: 'Total revenue',
    subtitle: m => `${money(m.revenueGross)} charged · ${money(m.revenueEarned)} kept after tax and card fees`,
    note: 'Rentals, renewals, installments and tips. Deposits are the customer\'s money held in trust, so they are excluded.',
  },
  fees: {
    title: 'Fees collected',
    subtitle: (m, rows) =>
      `${money(m.feesCollected)} across ${rows.length} charge${rows.length === 1 ? '' : 's'} that carried a fee`,
    note: 'The fee-table portion of each charge — the setup/protection bundle plus any missed-collection admin fee. Not the bike itself.',
  },
  ccFees: {
    title: 'Card processing collected',
    subtitle: m => `We charged ${money(m.ccFeesCollected)} · Stripe took ${money(m.stripeFees)} · spread ${m.spread >= 0 ? '+' : ''}${money(m.spread)}`,
    note: 'The card-processing line item customers paid, next to what Stripe actually charged us for the same transaction.',
  },
  tax: {
    title: 'Tax collected',
    subtitle: m => `${money(m.taxCollected)} collected on behalf of the taxing jurisdiction`,
    note: 'Sales tax at the rate declared by the store the bike went out from. Owed onward — it is never revenue.',
  },
  volume: {
    title: 'All transactions',
    subtitle: (m, rows) => `${rows.length} transactions across ${m.orderCount} orders · ${money(m.processed)} processed`,
    note: 'Every money movement through Stripe in this range, deposits and refunds included.',
  },
  stripePaid: {
    title: 'Paid out by Stripe',
    subtitle: m => `${money(m.processed)} processed − ${money(m.stripeFees)} in Stripe fees = ${money(m.stripePaid)}`,
    note: 'What actually landed in the platform balance, read from each charge\'s balance transaction.',
  },
  spread: {
    title: 'Card fee spread',
    subtitle: m => `${money(m.ccFeesCollected)} charged − ${money(m.stripeFees)} taken = ${m.spread >= 0 ? '+' : ''}${money(m.spread)}`,
    note: 'Positive means the card fee we bill covers what Stripe charges. Deposits carry no card-fee line, so they always run negative.',
  },
};

// The full table lives in the drilldown; the page shows the most recent slice so
// rendering a busy month never costs the whole page's paint.
const PREVIEW_ROWS = 12;

function TransactionPreview({ txns, onOpenAll }: { txns: Txn[]; onOpenAll: () => void }) {
  const recent = txns.slice(0, PREVIEW_ROWS);
  if (recent.length === 0) {
    return <p className="text-stone-400 font-mono text-xs text-center py-8">No transactions in this range.</p>;
  }
  return (
    <>
      <div className="overflow-x-auto -mx-2 px-2">
        <table className="w-full min-w-[720px] text-left">
          <thead>
            <tr className="border-b-2 border-stone-200 text-[9px] font-black uppercase text-stone-400 tracking-widest">
              <th className="pb-3 pr-3">When</th>
              <th className="pb-3 pr-3">Type</th>
              <th className="pb-3 pr-3">Customer</th>
              <th className="pb-3 pr-3 text-right">We charged</th>
              <th className="pb-3 pr-3 text-right">Stripe took</th>
              <th className="pb-3 pr-3 text-right">Stripe paid</th>
              <th className="pb-3 text-right">Difference</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {recent.map(t => (
              <tr key={t.id}>
                <td className="py-3 pr-3 font-mono text-[11px] text-stone-500 whitespace-nowrap">
                  {new Date(t.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </td>
                <td className="py-3 pr-3">
                  <span className="text-[9px] font-black uppercase px-2 py-1 border-2 border-black bg-stone-100 whitespace-nowrap">
                    {t.kind.replace('_', ' ')}
                  </span>
                </td>
                <td className="py-3 pr-3 text-xs font-black uppercase truncate max-w-[160px]">{t.customerName || '—'}</td>
                <td className="py-3 pr-3 text-right font-black text-xs whitespace-nowrap">{money(t.amount)}</td>
                <td className="py-3 pr-3 text-right font-mono text-[11px] text-rose-600 whitespace-nowrap">
                  −{money(t.stripeFeeResolved).replace('−', '')}{t.estimated ? ' est' : ''}
                </td>
                <td className="py-3 pr-3 text-right font-black text-xs text-emerald-700 whitespace-nowrap">
                  {money(t.stripeNetResolved)}
                </td>
                <td className={`py-3 text-right font-black text-xs whitespace-nowrap ${t.spread < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {t.spread >= 0 ? '+' : ''}{money(t.spread)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {txns.length > PREVIEW_ROWS && (
        <button
          onClick={onOpenAll}
          className="mt-4 px-4 py-2 bg-white border-2 border-black shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] font-black uppercase text-[10px] tracking-widest hover:bg-stone-50"
        >
          View all {txns.length} transactions
        </button>
      )}
    </>
  );
}
