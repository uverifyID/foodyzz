import React, { useMemo, useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Cell,
} from 'recharts';
import {
  X, Building, User, DollarSign, ShoppingBag, Star, CheckCircle2, Ban, Activity,
  TrendingUp, TrendingUp as TrendingUpIcon, ShieldAlert, ShieldCheck, Contact, MapPin, Mail,
} from 'lucide-react';
import { UserProfile, ProviderProfile, RentalOrder, GlobalConfig } from '../../types';
import StatCard from './StatCard';

interface FleetInsightsModalProps {
  entity: UserProfile | ProviderProfile;
  isProvider: boolean;
  orders: RentalOrder[];
  config: GlobalConfig | null;
  onClose: () => void;
  onToggleBlock: () => void;
}

// Revenue convention mirrors AnalyticsTab: only delivered/completed orders count.
const REVENUE_STATUSES = ['delivered', 'completed'];
const CLOSED_STATUSES = ['delivered', 'cancelled'];

// Short labels + colors for the status distribution chart.
// Three semantic states, not nine hues. Every bar is labelled on the x-axis, so
// colour carries the state group and the label carries identity. Validated with
// the dataviz palette checker on a light surface: all checks pass. Emerald is
// intentionally absent — beside the green brand it read as the same colour.
const STATUS_OPEN = '#4338CA';       // requested / confirmed / in flight
const STATUS_DONE = '#507425';       // completed / delivered — the brand green
const STATUS_CANCEL = '#BE123C';   // cancelled

const STATUS_META: Record<string, { label: string; color: string }> = {
  requested: { label: 'Req', color: STATUS_OPEN },
  confirmed: { label: 'Conf', color: STATUS_OPEN },
  en_route_pickup: { label: 'En Route', color: STATUS_OPEN },
  at_pickup: { label: 'On Site', color: STATUS_OPEN },
  completed: { label: 'Done', color: STATUS_DONE },
  en_route_delivery: { label: 'To Deliv', color: STATUS_OPEN },
  at_delivery: { label: 'At Deliv', color: STATUS_OPEN },
  delivered: { label: 'Delivered', color: STATUS_DONE },
  cancelled: { label: 'Cancelled', color: STATUS_CANCEL },
};

const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString();
};

export default function FleetInsightsModal({ entity, isProvider, orders, config, onClose, onToggleBlock }: FleetInsightsModalProps) {
  const [chartView, setChartView] = useState<'revenue' | 'volume'>('revenue');

  const provider = isProvider ? (entity as ProviderProfile) : null;
  const customer = isProvider ? null : (entity as UserProfile);
  const entityId = isProvider ? (provider!.id || `${provider!.phoneNumber}_${provider!.zipCode}`) : customer!.phoneNumber;
  const displayName = isProvider ? provider!.businessName : customer!.name;
  const isBlocked = !!entity.isBlocked;

  const linked = useMemo(() => {
    const list = isProvider
      ? orders.filter(o => o.providerId === entityId)
      : orders.filter(o => o.customerPhone === entityId);
    return [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  }, [orders, entityId, isProvider]);

  const m = useMemo(() => {
    const completed = linked.filter(o => REVENUE_STATUSES.includes(o.status));
    const active = linked.filter(o => !CLOSED_STATUSES.includes(o.status));
    const cancelled = linked.filter(o => o.status === 'cancelled');
    const revenue = completed.reduce((s, o) => s + (o.finalPrice ?? o.estimatedPrice ?? 0), 0);
    const rated = linked.filter(o => typeof o.rating === 'number' && (o.rating as number) > 0);
    const avgRating = rated.length ? rated.reduce((s, o) => s + (o.rating as number), 0) / rated.length : null;
    const dates = linked.map(o => o.createdAt).filter(Boolean).sort();
    return {
      total: linked.length,
      completedCount: completed.length,
      activeCount: active.length,
      cancelledCount: cancelled.length,
      revenue,
      avgOrderValue: completed.length ? revenue / completed.length : 0,
      avgRating,
      ratedCount: rated.length,
      completionRate: linked.length ? (completed.length / linked.length) * 100 : 0,
      cancelRate: linked.length ? (cancelled.length / linked.length) * 100 : 0,
      firstOrder: dates[0],
      lastOrder: dates[dates.length - 1],
    };
  }, [linked]);

  // Health at-a-glance.
  const health = useMemo(() => {
    if (isBlocked) return { label: 'Inactive', cls: 'bg-stone-200 text-stone-600 border-stone-400' };
    if (m.total === 0) return { label: 'New', cls: 'bg-indigo-100 text-indigo-700 border-indigo-400' };
    if (isProvider) {
      if (m.completionRate >= 80 && (m.avgRating ?? 5) >= 4.5) return { label: 'Healthy', cls: 'bg-emerald-100 text-emerald-700 border-emerald-500' };
      if (m.completionRate >= 60 && (m.avgRating ?? 5) >= 4) return { label: 'Steady', cls: 'bg-yellow-100 text-yellow-700 border-yellow-500' };
      return { label: 'At Risk', cls: 'bg-rose-100 text-rose-700 border-rose-500' };
    }
    if (m.cancelRate > 40) return { label: 'At Risk', cls: 'bg-rose-100 text-rose-700 border-rose-500' };
    if (m.completedCount >= 3) return { label: 'Loyal', cls: 'bg-emerald-100 text-emerald-700 border-emerald-500' };
    return { label: 'Active', cls: 'bg-yellow-100 text-yellow-700 border-yellow-500' };
  }, [isBlocked, isProvider, m]);

  // Monthly trend (revenue + volume).
  const trend = useMemo(() => {
    const buckets = new Map<string, { revenue: number; orders: number }>();
    for (const o of linked) {
      const d = o.createdAt ? new Date(o.createdAt) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const b = buckets.get(key) ?? { revenue: 0, orders: 0 };
      b.orders += 1;
      if (REVENUE_STATUSES.includes(o.status)) b.revenue += o.finalPrice ?? o.estimatedPrice ?? 0;
      buckets.set(key, b);
    }
    return Array.from(buckets.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([key, v]) => {
        const [y, mo] = key.split('-');
        return {
          label: new Date(Number(y), Number(mo) - 1, 1).toLocaleString(undefined, { month: 'short', year: '2-digit' }),
          revenue: Number(v.revenue.toFixed(2)),
          orders: v.orders,
        };
      });
  }, [linked]);

  // Status distribution.
  const statusData = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of linked) counts.set(o.status, (counts.get(o.status) ?? 0) + 1);
    return Array.from(counts.entries()).map(([status, count]) => ({
      status,
      label: STATUS_META[status]?.label ?? status,
      color: STATUS_META[status]?.color ?? '#507425',
      count,
    }));
  }, [linked]);

  const recent = linked.slice(0, 8);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white border-4 border-black shadow-brutalist w-full max-w-5xl max-h-[92vh] flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b-4 border-black gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className={`w-12 h-12 border-2 border-black flex items-center justify-center rounded shrink-0 ${isProvider ? 'bg-brand-green' : 'bg-brand-green'}`}>
              {isProvider ? <Building size={22} /> : <User size={22} />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-black uppercase tracking-tighter text-2xl leading-none truncate">{displayName || 'Unnamed'}</h2>
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 border-2 ${health.cls}`}>{health.label}</span>
              </div>
              <p className="text-xs font-mono text-stone-400 mt-1">
                {entity.phoneNumber} · {isProvider ? 'Provider' : 'Customer'}
                {isProvider && provider!.zipCode ? ` · ZIP ${provider!.zipCode}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onToggleBlock}
              title={isBlocked ? 'Reactivate' : 'Deactivate'}
              className={`flex items-center gap-2 px-3 py-2 border-2 border-black font-black uppercase text-[10px] tracking-widest transition-all ${isBlocked ? 'bg-emerald-400 text-white' : 'bg-white text-stone-500 hover:text-rose-500'}`}
            >
              {isBlocked ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
              {isBlocked ? 'Reactivate' : 'Deactivate'}
            </button>
            <button onClick={onClose} className="p-2 border-2 border-black hover:bg-stone-100 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-6 space-y-6">
          {/* At-a-glance stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard title={isProvider ? 'Total Revenue' : 'Total Spent'} value={money(m.revenue)} icon={<DollarSign />} color="bg-emerald-100" />
            <StatCard title={isProvider ? 'Orders Completed' : 'Orders'} value={isProvider ? m.completedCount : m.total} icon={<ShoppingBag />} color="bg-indigo-100" trend={`${m.total} total`} />
            <StatCard title="Completion Rate" value={`${m.completionRate.toFixed(0)}%`} icon={<CheckCircle2 />} color="bg-brand-green/10" />
            <StatCard title={isProvider ? 'Avg Rating' : 'Avg Rating Given'} value={m.avgRating != null ? `${m.avgRating.toFixed(1)} / 5` : '—'} icon={<Star />} trend={m.ratedCount ? `${m.ratedCount} rated` : undefined} color="bg-yellow-100" />
            <StatCard title="Active Orders" value={m.activeCount} icon={<Activity />} color="bg-white" />
            <StatCard title="Cancelled" value={m.cancelledCount} icon={<Ban />} color="bg-white" trend={m.total ? `${m.cancelRate.toFixed(0)}%` : undefined} />
            <StatCard title="Avg Order Value" value={money(m.avgOrderValue)} icon={<TrendingUp />} color="bg-white" />
            <StatCard title="Last Order" value={fmtDate(m.lastOrder)} icon={<Activity />} color="bg-white" />
          </div>

          {/* Profile details */}
          <div className="grid md:grid-cols-1 gap-4">
            <div className="border-4 border-black p-5 shadow-brutalist bg-white">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-stone-400 mb-3 flex items-center gap-2">
                {isProvider ? <Building size={14} /> : <User size={14} />} Profile
              </h3>
              <div className="space-y-2">
                {isProvider ? (
                  <>
                    <Field label="Email" value={provider!.email || '—'} icon={<Mail size={11} />} />
                    <Field label="Address" value={provider!.address || '—'} icon={<MapPin size={11} />} />
                    <Field label="Onboarded" value={provider!.onboarded ? 'Yes' : 'No'} />
                    <Field label="Services Active" value={provider!.servicesActive === false ? 'Paused' : 'Active'} />
                  </>
                ) : (
                  <>
                    <Field label="Email" value={customer!.email || '—'} icon={<Mail size={11} />} />
                    <Field label="Address" value={customer!.address || '—'} icon={<MapPin size={11} />} />
                    <Field label="ZIP" value={customer!.zipCode || '—'} />
                    <Field
                      label="Driver License"
                      value={
                        !customer!.driverLicense?.frontPath ? 'Not submitted'
                        : customer!.driverLicense.reviewedAt ? 'Verified'
                        : customer!.driverLicense.rejectedReason ? 'Rejected'
                        : 'Awaiting review'
                      }
                      icon={<Contact size={11} />}
                    />
                    <Field label="First Order" value={fmtDate(m.firstOrder)} />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Trend chart */}
          <section className="bg-white border-4 border-black p-6 shadow-brutalist">
            <div className="flex flex-col md:flex-row justify-between items-center mb-6 gap-4">
              <h3 className="text-lg font-black uppercase flex items-center gap-2 italic">
                <TrendingUpIcon size={20} className={chartView === 'revenue' ? 'text-brand-green-dark' : 'text-brand-green-dark'} />
                Monthly {chartView === 'revenue' ? 'Revenue' : 'Order Volume'}
              </h3>
              <div className="flex gap-1 bg-stone-100 p-1 border-2 border-black">
                {(['revenue', 'volume'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setChartView(view)}
                    className={`px-3 py-1 font-black uppercase text-[9px] tracking-widest transition-all ${chartView === view ? 'bg-black text-white' : 'text-stone-500 hover:bg-stone-200'}`}
                  >
                    {view}
                  </button>
                ))}
              </div>
            </div>
            {trend.length === 0 ? (
              <EmptyChart label="No order history yet" />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <defs>
                      <linearGradient id="fleetRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#507425" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#507425" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="fleetVolume" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#507425" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#507425" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="label" axisLine={{ stroke: '#000', strokeWidth: 2 }} tickLine={false} tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }} dy={10} />
                    <YAxis axisLine={{ stroke: '#000', strokeWidth: 2 }} tickLine={false} tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }} tickFormatter={(v) => (chartView === 'revenue' ? `$${v}` : `${v}`)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '4px solid #000', borderRadius: '0px', boxShadow: '4px 4px 0px 0px #000', fontFamily: 'JetBrains Mono' }}
                      labelStyle={{ fontWeight: '900', marginBottom: '4px', textTransform: 'uppercase' }}
                      itemStyle={{ color: chartView === 'revenue' ? '#507425' : '#4338CA', fontWeight: '900' }}
                      formatter={(v: any) => (chartView === 'revenue' ? money(Number(v)) : v)}
                    />
                    <Area type="monotone" dataKey={chartView === 'revenue' ? 'revenue' : 'orders'} stroke="#000" strokeWidth={4} fill={chartView === 'revenue' ? 'url(#fleetRevenue)' : 'url(#fleetVolume)'} animationDuration={1200} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Status distribution */}
          <section className="bg-white border-4 border-black p-6 shadow-brutalist">
            <h3 className="text-lg font-black uppercase flex items-center gap-2 italic mb-6">
              <ShoppingBag size={20} className="text-brand-green-dark" /> Orders by Status
            </h3>
            {statusData.length === 0 ? (
              <EmptyChart label="No orders to break down" />
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statusData}>
                    <CartesianGrid strokeDasharray="0" vertical={false} stroke="#f0f0f0" />
                    <XAxis dataKey="label" axisLine={{ stroke: '#000', strokeWidth: 2 }} tickLine={false} tick={{ fontSize: 9, fontWeight: '900', fill: '#000' }} dy={8} />
                    <YAxis allowDecimals={false} axisLine={{ stroke: '#000', strokeWidth: 2 }} tickLine={false} tick={{ fontSize: 10, fontWeight: '900', fill: '#000' }} />
                    <Tooltip
                      cursor={{ fill: '#f5f5f4' }}
                      contentStyle={{ backgroundColor: '#fff', border: '4px solid #000', borderRadius: '0px', boxShadow: '4px 4px 0px 0px #000', fontFamily: 'JetBrains Mono' }}
                      labelStyle={{ fontWeight: '900', textTransform: 'uppercase' }}
                    />
                    <Bar dataKey="count" stroke="#000" strokeWidth={2} animationDuration={1000}>
                      {statusData.map((s) => <Cell key={s.status} fill={s.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Recent orders */}
          <section className="bg-white border-4 border-black shadow-brutalist overflow-hidden">
            <h3 className="text-lg font-black uppercase flex items-center gap-2 italic p-6 pb-4">
              <Activity size={20} className="text-brand-green-dark" /> Recent Orders
            </h3>
            {recent.length === 0 ? (
              <p className="px-6 pb-6 text-stone-400 font-mono text-sm">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-black text-white uppercase text-[10px] tracking-widest">
                    <tr>
                      <th className="text-left p-3">Date</th>
                      <th className="text-left p-3">{isProvider ? 'Customer' : 'Provider'}</th>
                      <th className="text-left p-3">Status</th>
                      <th className="text-right p-3">Amount</th>
                      <th className="text-center p-3">Rating</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recent.map((o) => (
                      <tr key={o.id} className="border-t-2 border-stone-200">
                        <td className="p-3 font-mono text-xs text-stone-500">{fmtDate(o.createdAt)}</td>
                        <td className="p-3 font-bold truncate max-w-[180px]">{isProvider ? o.customerName : o.providerName}</td>
                        <td className="p-3">
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${REVENUE_STATUSES.includes(o.status) ? 'bg-emerald-100 text-emerald-700' : o.status === 'cancelled' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>
                            {STATUS_META[o.status]?.label ?? o.status}
                          </span>
                        </td>
                        <td className="p-3 text-right font-mono">{money(o.finalPrice ?? o.estimatedPrice ?? 0)}</td>
                        <td className="p-3 text-center font-mono">{o.rating ? `${o.rating}★` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, icon, mono }: { label: string; value: string; icon?: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <span className="text-[8px] font-black text-stone-400 uppercase tracking-widest block">{label}</span>
      <p className={`text-sm font-bold flex items-center gap-1.5 ${mono ? 'font-mono' : ''}`}>
        {icon && <span className="text-stone-400 shrink-0">{icon}</span>}
        <span className="truncate">{value}</span>
      </p>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-40 flex items-center justify-center border-2 border-dashed border-stone-200">
      <p className="text-stone-400 font-black uppercase text-xs tracking-widest">{label}</p>
    </div>
  );
}
