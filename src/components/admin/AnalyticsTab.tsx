import React, { useState, useEffect, useMemo } from 'react';
import { DollarSign, TrendingUp, ShoppingBag, Sparkles, Activity, TrendingUp as TrendingUpIcon, AlertCircle } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { DailyStats, ProviderPerformance, RentalOrder } from '../../types';
import StatCard from './StatCard';
import { db } from '../../firebase';
import { doc, onSnapshot } from 'firebase/firestore';

interface AnalyticsTabProps {
  dailyStats: DailyStats[];
  providerPerf: ProviderPerformance[];
  ordersCount: number;
  orders: RentalOrder[];
}

// Derive daily stats from raw orders when Firestore stats collection is empty.
// Groups orders by createdAt date and sums revenue/commission per day.
function buildFallbackStats(orders: RentalOrder[], commissionRate: number): DailyStats[] {
  const byDate: Record<string, DailyStats> = {};
  orders.forEach(order => {
    const date = order.createdAt?.split('T')[0];
    if (!date) return;
    if (!byDate[date]) {
      byDate[date] = {
        date,
        totalRevenue: 0,
        totalCommission: 0,
        orderCount: 0,
        cancelledCount: 0,
        averageSatisfaction: 5.0,
        ratingSum: 0,
        ratedCount: 0,
        updatedAt: '',
      };
    }
    const d = byDate[date];
    const price = order.finalPrice ?? order.estimatedPrice ?? 0;
    d.orderCount += 1;
    if (order.status === 'cancelled') d.cancelledCount += 1;
    if (['delivered', 'completed'].includes(order.status)) {
      d.totalRevenue += price;
      d.totalCommission += price * commissionRate;
    }
    if (order.rating) {
      d.ratingSum += order.rating;
      d.ratedCount += 1;
      d.averageSatisfaction = d.ratingSum / d.ratedCount;
    }
  });
  return Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date));
}

export default function AnalyticsTab({ dailyStats, providerPerf, ordersCount, orders }: AnalyticsTabProps) {
  const [todayStats, setTodayStats] = useState<DailyStats | null>(null);
  const [selectedRange, setSelectedRange] = useState<'today' | 'weekly' | 'monthly'>('today');
  const [chartView, setChartView] = useState<'revenue' | 'volume'>('revenue');

  // Real-time listener for today's stats document
  useEffect(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    const unsub = onSnapshot(doc(db, 'stats', todayStr), (snap) => {
      if (snap.exists()) {
        setTodayStats(snap.data() as DailyStats);
      } else {
        setTodayStats({
          date: todayStr,
          totalRevenue: 0,
          totalCommission: 0,
          orderCount: 0,
          cancelledCount: 0,
          averageSatisfaction: 5.0,
          ratingSum: 0,
          ratedCount: 0,
          updatedAt: '',
        });
      }
    });
    return unsub;
  }, []);

  // Use Cloud Function stats if available; otherwise fall back to raw orders
  const statsEmpty = dailyStats.length === 0;
  const fallbackStats = useMemo(
    () => (statsEmpty ? buildFallbackStats(orders, 0.20) : []),
    [orders, statsEmpty]
  );
  const effectiveStats = statsEmpty ? fallbackStats : dailyStats;

  // Build today's effective stats for the "Today" range when stats are empty
  const effectiveTodayStats = useMemo(() => {
    if (!statsEmpty) return todayStats;
    // Derive today from fallback
    const todayStr = new Date().toISOString().split('T')[0];
    return fallbackStats.find(d => d.date === todayStr) ?? todayStats;
  }, [statsEmpty, fallbackStats, todayStats]);

  const aggregatedMetrics = useMemo(() => {
    const metrics = { revenue: 0, commission: 0, orders: 0, satisfaction: 5.0, ratingSum: 0, ratedCount: 0 };

    if (selectedRange === 'today') {
      metrics.revenue = effectiveTodayStats?.totalRevenue || 0;
      metrics.commission = effectiveTodayStats?.totalCommission || 0;
      metrics.orders = effectiveTodayStats?.orderCount || 0;
      // Derive satisfaction from the raw counters (same as the weekly/monthly path).
      // The Cloud Function now stores ratingSum/ratedCount via atomic increments and
      // no longer persists the averageSatisfaction ratio.
      metrics.satisfaction = (effectiveTodayStats?.ratedCount ?? 0) > 0
        ? (effectiveTodayStats!.ratingSum / effectiveTodayStats!.ratedCount)
        : 5.0;
    } else {
      const daysToSum = selectedRange === 'weekly' ? 7 : 30;
      effectiveStats.slice(0, daysToSum).forEach(day => {
        metrics.revenue += day.totalRevenue;
        metrics.commission += day.totalCommission;
        metrics.orders += day.orderCount;
        metrics.ratingSum += day.ratingSum || 0;
        metrics.ratedCount += day.ratedCount || 0;
      });
      if (metrics.ratedCount > 0) metrics.satisfaction = metrics.ratingSum / metrics.ratedCount;
    }
    return metrics;
  }, [selectedRange, effectiveTodayStats, effectiveStats]);

  const trendData = useMemo(() => {
    const combined = [...effectiveStats];
    if (effectiveTodayStats && !combined.find(d => d.date === effectiveTodayStats.date)) {
      combined.push(effectiveTodayStats);
    }
    return combined
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-30)
      .map(d => ({
        ...d,
        formattedDate: new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      }));
  }, [effectiveStats, effectiveTodayStats]);

  // Derive provider leaderboard from raw orders when providerPerformance is empty
  const effectiveProviderPerf = useMemo(() => {
    if (providerPerf.length > 0) return providerPerf;
    const byProvider: Record<string, ProviderPerformance> = {};
    orders.forEach(order => {
      if (!order.providerId || order.providerId === 'broadcast') return;
      if (!byProvider[order.providerId]) {
        byProvider[order.providerId] = {
          providerId: order.providerId,
          businessName: order.providerName || order.providerId,
          totalRevenue: 0,
          ordersCompleted: 0,
          totalAttempts: 0,
          ratingSum: 0,
          ratedCount: 0,
          completionRate: 0,
          avgRating: 5.0,
          lastOrderAt: '',
          updatedAt: '',
        };
      }
      const p = byProvider[order.providerId];
      p.totalAttempts += 1;
      if (['delivered', 'completed'].includes(order.status)) {
        p.ordersCompleted += 1;
        p.totalRevenue += order.finalPrice ?? order.estimatedPrice ?? 0;
      }
      if (order.rating) { p.ratingSum += order.rating; p.ratedCount += 1; }
      p.completionRate = p.totalAttempts > 0 ? (p.ordersCompleted / p.totalAttempts) * 100 : 0;
      p.avgRating = p.ratedCount > 0 ? p.ratingSum / p.ratedCount : 5.0;
      if (!p.lastOrderAt || order.createdAt > p.lastOrderAt) p.lastOrderAt = order.createdAt;
    });
    return Object.values(byProvider).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [providerPerf, orders]);

  const historyRevenue = effectiveStats.reduce((s, d) => s + d.totalRevenue, 0);

  return (
    <div className="space-y-8">
      <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter italic">Insights & Revenue</h2>
          <p className="text-stone-500 text-sm font-bold uppercase font-mono">Platform performance and fleet metrics</p>
        </div>
        <div className="flex gap-1 bg-stone-200 p-1 border-2 border-black shadow-brutalist">
          {(['today', 'weekly', 'monthly'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setSelectedRange(range)}
              className={`px-4 py-2 font-black uppercase text-[10px] tracking-widest transition-all ${
                selectedRange === range ? 'bg-black text-white' : 'text-stone-500 hover:bg-stone-300'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </header>

      {/* Fallback notice */}
      {statsEmpty && orders.length > 0 && (
        <div className="flex items-center gap-3 bg-yellow-50 border-4 border-yellow-400 px-4 py-3 shadow-[4px_4px_0px_0px_rgba(250,204,21,1)]">
          <AlertCircle size={16} className="text-yellow-600 flex-shrink-0" />
          <p className="text-xs font-bold font-mono text-yellow-800">
            Stats computed from raw orders — Cloud Function analytics collection not yet populated.
            Revenue only counts delivered/completed orders.
          </p>
        </div>
      )}

      <section>
        <h3 className="text-[10px] font-black uppercase text-brand-green-dark mb-4 tracking-[0.2em] flex items-center gap-2">
          <Activity size={14}/> {selectedRange} snapshot
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <StatCard
            title={`${selectedRange} Revenue`}
            value={`$${aggregatedMetrics.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={<DollarSign/>}
            color="bg-emerald-100"
          />
          <StatCard
            title={`${selectedRange} Commission`}
            value={`$${aggregatedMetrics.commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
            icon={<TrendingUp/>}
            color="bg-brand-green/10"
          />
          <StatCard
            title={`${selectedRange} Volume`}
            value={`${aggregatedMetrics.orders}`}
            icon={<ShoppingBag/>}
            trend={selectedRange === 'today' ? `${ordersCount} active now` : undefined}
            color="bg-indigo-100"
          />
          <StatCard
            title="Customer Satisfaction"
            value={`${aggregatedMetrics.satisfaction.toFixed(1)} / 5`}
            icon={<Sparkles/>}
            color="bg-yellow-100"
          />
        </div>
      </section>

      <section className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
          <h3 className="text-lg font-black uppercase flex items-center gap-2 italic">
            <TrendingUpIcon size={20} className={chartView === 'revenue' ? 'text-brand-green-dark' : 'text-brand-green-dark'} />
            30-Day {chartView === 'revenue' ? 'Revenue Flow' : 'Order Volume'}
          </h3>
          <div className="flex gap-1 bg-stone-100 p-1 border-2 border-black">
            {(['revenue', 'volume'] as const).map((view) => (
              <button
                key={view}
                onClick={() => setChartView(view)}
                className={`px-3 py-1 font-black uppercase text-[9px] tracking-widest transition-all ${
                  chartView === view ? 'bg-black text-white' : 'text-stone-500 hover:bg-stone-200'
                }`}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#507425" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#507425" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4338CA" stopOpacity={0.1}/>
                  <stop offset="95%" stopColor="#4338CA" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f0f0f0" />
              <XAxis
                dataKey="formattedDate"
                axisLine={{ stroke: '#000', strokeWidth: 2 }}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }}
                dy={10}
              />
              <YAxis
                axisLine={{ stroke: '#000', strokeWidth: 2 }}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }}
                tickFormatter={(v) => chartView === 'revenue' ? `$${v}` : v}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#fff', border: '4px solid #000', borderRadius: '0px', boxShadow: '4px 4px 0px 0px #000', fontFamily: 'JetBrains Mono' }}
                labelStyle={{ fontWeight: '900', marginBottom: '4px', textTransform: 'uppercase' }}
                itemStyle={{ color: chartView === 'revenue' ? '#507425' : '#4338CA', fontWeight: '900' }}
              />
              <Area
                type="monotone"
                dataKey={chartView === 'revenue' ? 'totalRevenue' : 'orderCount'}
                stroke="#000"
                strokeWidth={4}
                fill={chartView === 'revenue' ? 'url(#colorRevenue)' : 'url(#colorVolume)'}
                animationDuration={1500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="bg-white border-4 border-black p-6 shadow-brutalist">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-black uppercase">Provider Performance Leaderboard</h3>
          <div className="text-[10px] font-mono font-bold text-stone-400 uppercase">
            Total Revenue: ${historyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
        </div>
        {effectiveProviderPerf.length === 0 ? (
          <p className="text-stone-400 font-mono text-xs text-center py-8">No provider data yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-2 px-2">
          <table className="w-full min-w-[480px] text-left">
            <thead>
              <tr className="border-b-2 border-stone-100 text-[10px] font-black uppercase text-stone-400">
                <th className="pb-4">Partner</th>
                <th className="pb-4">Orders</th>
                <th className="pb-4">Completion</th>
                <th className="pb-4">Rating</th>
                <th className="pb-4 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-50">
              {effectiveProviderPerf.map(p => (
                <tr key={p.providerId}>
                  <td className="py-4 font-black uppercase text-xs">{p.businessName}</td>
                  <td className="py-4 font-mono text-xs">{p.ordersCompleted}</td>
                  <td className="py-4">
                    <div className="w-16 h-2 bg-stone-100 rounded-full overflow-hidden border border-black/5">
                      <div className="bg-emerald-400 h-full" style={{ width: `${p.completionRate}%` }} />
                    </div>
                  </td>
                  <td className="py-4 font-bold text-xs text-yellow-600">⭐ {p.avgRating?.toFixed(1) || '5.0'}</td>
                  <td className="py-4 text-right font-black text-sm">${p.totalRevenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}
