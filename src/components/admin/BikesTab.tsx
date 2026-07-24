import React, { useMemo, useState } from 'react';
import { Bike, Plus, Search, X, History, AlertCircle, Wrench, CheckCircle2 } from 'lucide-react';
import { collection, doc, onSnapshot, setDoc, updateDoc, query, orderBy } from 'firebase/firestore';
import { db } from '../../firebase';
import { Bike as BikeDoc, BikeCondition, BikeHistoryEntry, BikeStatus, RentalOrder, LogisticsConfig } from '../../types';

interface BikesTabProps {
  logistics: LogisticsConfig | null;
  orders: RentalOrder[];
}

const STATUS_STYLE: Record<BikeStatus, string> = {
  available: 'bg-emerald-100 text-emerald-700',
  reserved: 'bg-amber-100 text-amber-700',
  rented: 'bg-brand-green/20 text-brand-green-dark',
  sold: 'bg-stone-200 text-stone-500',
  maintenance: 'bg-rose-100 text-rose-700',
};

const STATUSES: BikeStatus[] = ['available', 'reserved', 'rented', 'sold', 'maintenance'];

// Local YYYY-MM-DD today, for the overdue comparison. Bike dates are stored as
// plain local day strings, so comparing strings is both correct and timezone-safe.
const todayDay = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function BikesTab({ logistics, orders }: BikesTabProps) {
  const [bikes, setBikes] = useState<BikeDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<BikeStatus | 'all'>('all');
  const [modelFilter, setModelFilter] = useState<number | 'all'>('all');
  const [showAdd, setShowAdd] = useState(false);
  const [historyFor, setHistoryFor] = useState<BikeDoc | null>(null);

  React.useEffect(() => {
    return onSnapshot(
      query(collection(db, 'bikes'), orderBy('bikeNo', 'asc')),
      (snap) => {
        setBikes(snap.docs.map(d => ({ ...d.data(), id: d.id } as BikeDoc)));
        setLoading(false);
      },
      (e) => { console.error('bikes listener failed:', e); setLoading(false); },
    );
  }, []);

  const today = todayDay();

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return bikes.filter(b => {
      if (statusFilter !== 'all' && b.status !== statusFilter) return false;
      if (modelFilter !== 'all' && b.model !== modelFilter) return false;
      if (!term) return true;
      return (
        String(b.bikeNo).includes(term) ||
        (b.rentedBy || '').toLowerCase().includes(term) ||
        (b.currentOrderId || '').toLowerCase().includes(term)
      );
    });
  }, [bikes, search, statusFilter, modelFilter, today]);

  // Per-model rollup, which is what the customer app's availability check reduces to.
  const rollup = useMemo(() => {
    const byModel: Record<number, { new: number; used: number; out: number; overdue: number }> = {};
    for (const b of bikes) {
      if (!byModel[b.model]) byModel[b.model] = { new: 0, used: 0, out: 0, overdue: 0 };
      const row = byModel[b.model];
      if (b.status === 'available') row[b.condition] += 1;
      if (b.status === 'rented' || b.status === 'reserved') {
        row.out += 1;
        if (b.expectedEndDate && b.expectedEndDate < today) row.overdue += 1;
      }
    }
    return byModel;
  }, [bikes, today]);

  const setStatus = async (bike: BikeDoc, status: BikeStatus) => {
    try {
      await updateDoc(doc(db, 'bikes', bike.id), { status });
    } catch (e: any) {
      alert(e?.message || 'Could not update the bike.');
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h2 className="text-3xl font-black uppercase tracking-tighter italic">Bike Fleet</h2>
          <p className="text-stone-500 text-sm font-bold uppercase font-mono">
            {bikes.length} bikes · {bikes.filter(b => b.status === 'available').length} available
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-black text-white font-black uppercase text-xs px-5 py-3 border-2 border-black shadow-brutalist hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all flex items-center gap-2 self-start"
        >
          <Plus size={16} /> Add Bike
        </button>
      </header>

      {/* Per-model rollup */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {(logistics?.bikeModels ?? []).map(m => {
          const r = rollup[m.model] || { new: 0, used: 0, out: 0, overdue: 0 };
          return (
            <div key={m.model} className="bg-white border-4 border-black p-5 shadow-brutalist">
              <div className="flex items-center gap-2 mb-3">
                <Bike size={18} />
                <h3 className="font-black uppercase text-sm">{m.name}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="border-2 border-black p-2">
                  <p className="text-2xl font-black tracking-tighter">{r.new}</p>
                  <p className="text-[8px] font-black uppercase text-stone-400 tracking-widest">New free</p>
                </div>
                <div className="border-2 border-black p-2">
                  <p className="text-2xl font-black tracking-tighter">{r.used}</p>
                  <p className="text-[8px] font-black uppercase text-stone-400 tracking-widest">Used free</p>
                </div>
              </div>
              <p className="text-[10px] font-mono text-stone-500 mt-3">
                {r.out} out
                {r.overdue > 0 && <span className="text-rose-600 font-black"> · {r.overdue} overdue</span>}
              </p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search bike no., renter phone, order id…"
            className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-sm focus:outline-none focus:border-brand-green"
          />
        </div>
        <select
          value={modelFilter}
          onChange={e => setModelFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          className="border-2 border-black px-3 py-2 font-black uppercase text-xs"
        >
          <option value="all">All models</option>
          {(logistics?.bikeModels ?? []).map(m => (
            <option key={m.model} value={m.model}>Model {m.model}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as BikeStatus | 'all')}
          className="border-2 border-black px-3 py-2 font-black uppercase text-xs"
        >
          <option value="all">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border-4 border-black shadow-brutalist overflow-x-auto">
        <table className="w-full text-left min-w-[820px]">
          <thead className="bg-black text-white">
            <tr>
              {['Bike', 'Model', 'Condition', 'Status', 'Rented by', 'Rented', 'Due back', ''].map(h => (
                <th key={h} className="px-4 py-3 font-black uppercase text-[10px] tracking-widest">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => {
              const overdue = !!b.expectedEndDate && b.expectedEndDate < today && (b.status === 'rented' || b.status === 'reserved');
              return (
                <tr key={b.id} className="border-b-2 border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 font-black text-sm">#{b.bikeNo}</td>
                  <td className="px-4 py-3 font-mono text-xs">{b.model}</td>
                  <td className="px-4 py-3 font-mono text-xs uppercase">{b.condition}</td>
                  <td className="px-4 py-3">
                    <select
                      value={b.status}
                      onChange={e => setStatus(b, e.target.value as BikeStatus)}
                      className={`font-black uppercase text-[10px] px-2 py-1 border-2 border-black ${STATUS_STYLE[b.status]}`}
                    >
                      {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{b.rentedBy || '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{b.rentedDate || '—'}</td>
                  <td className={`px-4 py-3 font-mono text-xs ${overdue ? 'text-rose-600 font-black' : ''}`}>
                    {b.expectedEndDate || '—'}
                    {overdue && <AlertCircle size={12} className="inline ml-1 -mt-0.5" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setHistoryFor(b)}
                      title="Rental history"
                      className="p-1.5 border-2 border-black hover:bg-brand-green hover:text-black transition-colors"
                    >
                      <History size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-stone-400 font-black uppercase text-xs tracking-widest">
                  No bikes match these filters
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-16 text-center text-stone-400 font-black uppercase text-xs tracking-widest">
                  Loading fleet…
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <AddBikeModal
          logistics={logistics}
          existing={bikes}
          onClose={() => setShowAdd(false)}
        />
      )}
      {historyFor && <HistoryModal bike={historyFor} orders={orders} onClose={() => setHistoryFor(null)} />}
    </div>
  );
}

// ── Add bike ────────────────────────────────────────────────────────────────

function AddBikeModal({
  logistics, existing, onClose,
}: { logistics: LogisticsConfig | null; existing: BikeDoc[]; onClose: () => void }) {
  // Bike numbers are a single increasing sequence across models (the appendix
  // starts at 1001), so the next one is simply max+1.
  const nextNo = existing.reduce((max, b) => Math.max(max, b.bikeNo), 1000) + 1;
  const [model, setModel] = useState<number>(logistics?.bikeModels?.[0]?.model ?? 1);
  const [condition, setCondition] = useState<BikeCondition>('new');
  const [bikeNo, setBikeNo] = useState<number>(nextNo);
  const [count, setCount] = useState(1);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (existing.some(b => b.bikeNo >= bikeNo && b.bikeNo < bikeNo + count)) {
      alert(`Bike numbers ${bikeNo}–${bikeNo + count - 1} overlap bikes that already exist.`);
      return;
    }
    setSaving(true);
    try {
      for (let i = 0; i < count; i++) {
        const no = bikeNo + i;
        const id = `bike_${no}`;
        await setDoc(doc(db, 'bikes', id), {
          id,
          model,
          bikeNo: no,
          condition,
          status: 'available',
          rentedBy: null,
          rentedDate: null,
          rentalDuration: null,
          expectedEndDate: null,
          currentOrderId: null,
          createdAt: new Date().toISOString(),
        });
      }
      onClose();
    } catch (e: any) {
      alert(e?.message || 'Could not add the bikes.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Add bikes to the fleet" onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">Model</label>
            <select value={model} onChange={e => setModel(Number(e.target.value))} className="w-full border-2 border-black px-3 py-2 font-mono text-sm">
              {(logistics?.bikeModels ?? [{ model: 1, name: 'Model 1' } as any]).map((m: any) => (
                <option key={m.model} value={m.model}>{m.name || `Model ${m.model}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">Condition</label>
            <select value={condition} onChange={e => setCondition(e.target.value as BikeCondition)} className="w-full border-2 border-black px-3 py-2 font-mono text-sm">
              <option value="new">New</option>
              <option value="used">Used</option>
            </select>
          </div>
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">Starting bike no.</label>
            <input type="number" value={bikeNo} onChange={e => setBikeNo(parseInt(e.target.value, 10) || 0)} className="w-full border-2 border-black px-3 py-2 font-mono text-sm" />
          </div>
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">How many</label>
            <input type="number" min={1} value={count} onChange={e => setCount(Math.max(1, parseInt(e.target.value, 10) || 1))} className="w-full border-2 border-black px-3 py-2 font-mono text-sm" />
          </div>
        </div>
        <p className="text-[11px] font-mono text-stone-400">
          Creates {count} bike{count === 1 ? '' : 's'} numbered {bikeNo}
          {count > 1 ? `–${bikeNo + count - 1}` : ''}, all marked available.
        </p>
        <button
          onClick={save}
          disabled={saving}
          className="w-full bg-black text-white font-black uppercase text-sm py-3 border-2 border-black shadow-brutalist hover:bg-brand-green hover:text-black transition-colors disabled:opacity-50"
        >
          {saving ? 'Adding…' : 'Add to fleet'}
        </button>
      </div>
    </Modal>
  );
}

// ── Rental history ──────────────────────────────────────────────────────────

function HistoryModal({ bike, orders, onClose }: { bike: BikeDoc; orders: RentalOrder[]; onClose: () => void }) {
  const [entries, setEntries] = useState<BikeHistoryEntry[] | null>(null);

  React.useEffect(() => {
    return onSnapshot(
      query(collection(db, 'bikes', bike.id, 'history'), orderBy('rentedDate', 'desc')),
      (snap) => setEntries(snap.docs.map(d => d.data() as BikeHistoryEntry)),
      (e) => { console.error('bike history listener failed:', e); setEntries([]); },
    );
  }, [bike.id]);

  // Orders that named this bike but whose history row hasn't been written yet
  // (e.g. a rental still in flight) — shown so the log is never misleadingly empty.
  const liveOrder = orders.find(o => o.bikeId === bike.id && !['delivered', 'cancelled'].includes(o.status));

  return (
    <Modal title={`Bike #${bike.bikeNo} · Model ${bike.model}`} onClose={onClose}>
      {liveOrder && (
        <div className="border-2 border-brand-green bg-brand-green/10 p-3 mb-4">
          <p className="font-black uppercase text-[10px] tracking-widest text-brand-green-dark mb-1">Currently out</p>
          <p className="font-mono text-xs">
            {liveOrder.customerName} · {liveOrder.startDate} → {liveOrder.expectedEndDate || '?'} · {liveOrder.status}
          </p>
        </div>
      )}
      {entries === null ? (
        <p className="text-stone-400 font-black uppercase text-xs tracking-widest py-8 text-center">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-stone-400 font-black uppercase text-xs tracking-widest py-8 text-center">No completed rentals yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[560px]">
            <thead className="bg-black text-white">
              <tr>
                {['Rented by', 'Rented', 'Duration', 'Due back', 'Returned', 'Type'].map(h => (
                  <th key={h} className="px-3 py-2 font-black uppercase text-[9px] tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={`${e.orderId}_${i}`} className="border-b-2 border-stone-100">
                  <td className="px-3 py-2 font-black text-xs">{e.rentedByName || e.rentedBy}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.rentedDate}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.rentalDuration}</td>
                  <td className="px-3 py-2 font-mono text-xs">{e.expectedEndDate}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {e.returnedDate
                      ? <span className="text-emerald-600 font-black"><CheckCircle2 size={11} className="inline -mt-0.5 mr-1" />{e.returnedDate}</span>
                      : <span className="text-stone-400">—</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs uppercase">{e.rentalType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {bike.status === 'maintenance' && (
        <p className="mt-4 flex items-center gap-2 text-[11px] font-mono text-rose-600">
          <Wrench size={13} /> This bike is flagged for maintenance and is excluded from availability.
        </p>
      )}
    </Modal>
  );
}

// ── Shared modal shell ──────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white border-4 border-black shadow-brutalist w-full max-w-3xl max-h-[85vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b-4 border-black px-6 py-4 sticky top-0 bg-white">
          <h3 className="font-black uppercase tracking-tighter text-lg">{title}</h3>
          <button onClick={onClose} className="p-1 hover:text-brand-green-dark"><X size={22} /></button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
