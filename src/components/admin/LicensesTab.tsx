import React, { useEffect, useMemo, useState } from 'react';
import { Contact, CheckCircle2, Clock, XCircle, Search, Phone } from 'lucide-react';
import { doc, setDoc } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db } from '../../firebase';
import { UserProfile } from '../../types';

interface LicensesTabProps {
  customers: UserProfile[];
}

type Bucket = 'pending' | 'verified' | 'rejected' | 'none';

const bucketOf = (c: UserProfile): Bucket => {
  const dl = c.driverLicense;
  if (!dl?.frontPath) return 'none';
  if (dl.rejectedReason) return 'rejected';
  return dl.reviewedAt ? 'verified' : 'pending';
};

const BUCKET_LABEL: Record<Bucket, string> = {
  pending: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Rejected',
  none: 'Not submitted',
};

export default function LicensesTab({ customers }: LicensesTabProps) {
  const [bucket, setBucket] = useState<Bucket>('pending');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { pending: 0, verified: 0, rejected: 0, none: 0 };
    customers.forEach(cu => { c[bucketOf(cu)] += 1; });
    return c;
  }, [customers]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return customers
      .filter(c => bucketOf(c) === bucket)
      .filter(c => !term || (c.name || '').toLowerCase().includes(term) || (c.phoneNumber || '').includes(term))
      // Oldest submission first — the person who has been waiting longest is reviewed first.
      .sort((a, b) => (a.driverLicense?.uploadedAt || '').localeCompare(b.driverLicense?.uploadedAt || ''));
  }, [customers, bucket, search]);

  // Keep the selected customer live as Firestore streams updates in, rather than
  // snapshotting the object at click time (an approve would otherwise show stale).
  const current = rows.find(r => r.phoneNumber === selected)
    ?? customers.find(c => c.phoneNumber === selected)
    ?? null;

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-black uppercase tracking-tighter italic">Driver Licenses</h2>
        <p className="text-stone-500 text-sm font-bold uppercase font-mono">
          Manual review — approve a rider before their bike goes out
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(['pending', 'verified', 'rejected', 'none'] as Bucket[]).map(b => (
          <button
            key={b}
            onClick={() => { setBucket(b); setSelected(null); }}
            className={`px-4 py-2 border-2 border-black font-black uppercase text-[10px] tracking-widest transition-all ${
              bucket === b ? 'bg-brand-green text-black shadow-brutalist' : 'bg-white hover:bg-stone-50'
            }`}
          >
            {BUCKET_LABEL[b]} ({counts[b]})
          </button>
        ))}
      </div>

      <div className="relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name or phone…"
          className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-sm focus:outline-none focus:border-brand-green"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Queue */}
        <div className="space-y-3 lg:col-span-1">
          {rows.map(c => (
            <button
              key={c.phoneNumber}
              onClick={() => setSelected(c.phoneNumber)}
              className={`w-full text-left bg-white border-2 border-black p-4 shadow-brutalist transition-colors ${
                selected === c.phoneNumber ? 'bg-brand-green/10' : 'hover:bg-stone-50'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="font-black uppercase text-xs truncate">{c.name || 'Unnamed'}</h4>
                  <p className="text-[10px] font-mono text-stone-400">{c.phoneNumber}</p>
                </div>
                <StatusPill bucket={bucketOf(c)} />
              </div>
              {c.driverLicense?.uploadedAt && (
                <p className="text-[10px] font-mono text-stone-400 mt-2">
                  Submitted {new Date(c.driverLicense.uploadedAt).toLocaleDateString()}
                </p>
              )}
            </button>
          ))}
          {rows.length === 0 && (
            <div className="p-12 text-center border-4 border-dashed border-stone-200">
              <Contact size={40} className="mx-auto text-stone-200 mb-3" />
              <p className="text-stone-400 font-black uppercase text-xs tracking-widest">Nothing here</p>
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {current ? (
            <LicenseDetail customer={current} />
          ) : (
            <div className="p-20 text-center border-4 border-dashed border-stone-200 h-full flex flex-col items-center justify-center">
              <Contact size={48} className="text-stone-200 mb-4" />
              <p className="text-stone-400 font-black uppercase text-xs tracking-widest">
                Select a customer to review
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({ bucket }: { bucket: Bucket }) {
  const style =
    bucket === 'verified' ? 'bg-emerald-100 text-emerald-700'
    : bucket === 'pending' ? 'bg-amber-100 text-amber-700'
    : bucket === 'rejected' ? 'bg-rose-100 text-rose-700'
    : 'bg-stone-100 text-stone-500';
  const Icon = bucket === 'verified' ? CheckCircle2 : bucket === 'rejected' ? XCircle : Clock;
  return (
    <span className={`shrink-0 flex items-center gap-1 px-2 py-1 border-2 border-black font-black uppercase text-[8px] tracking-widest ${style}`}>
      <Icon size={10} /> {bucket}
    </span>
  );
}

function LicenseDetail({ customer }: { customer: UserProfile }) {
  const dl = customer.driverLicense;
  const [urls, setUrls] = useState<{ front?: string; back?: string }>({});
  const [busy, setBusy] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  useEffect(() => {
    let cancelled = false;
    setUrls({});
    if (!dl?.frontPath) return;
    const storage = getStorage();
    Promise.all([
      getDownloadURL(ref(storage, dl.frontPath)),
      dl.backPath ? getDownloadURL(ref(storage, dl.backPath)) : Promise.resolve(''),
    ])
      .then(([front, back]) => { if (!cancelled) setUrls({ front, back }); })
      .catch(e => console.warn('license download url failed:', e));
    return () => { cancelled = true; };
  }, [dl?.frontPath, dl?.backPath]);

  // Approve / reject both write the same driverLicense record — a rejection keeps
  // reviewedAt null so the customer's re-scan lands back in the pending queue.
  const decide = async (approved: boolean) => {
    if (!dl) return;
    if (!approved && !rejectReason.trim()) {
      alert('Give the customer a reason so they know what to re-scan.');
      return;
    }
    setBusy(true);
    try {
      await setDoc(
        doc(db, 'users', customer.phoneNumber),
        {
          driverLicense: {
            ...dl,
            reviewedAt: approved ? new Date().toISOString() : null,
            reviewedBy: 'admin',
            rejectedReason: approved ? null : rejectReason.trim(),
          },
        },
        { merge: true },
      );
      setRejectReason('');
    } catch (e: any) {
      alert(e?.message || 'Could not save the decision.');
    } finally {
      setBusy(false);
    }
  };

  if (!dl?.frontPath) {
    return (
      <div className="bg-white border-4 border-black p-8 shadow-brutalist">
        <h3 className="font-black uppercase text-lg mb-1">{customer.name || 'Unnamed'}</h3>
        <p className="font-mono text-xs text-stone-400 mb-4">{customer.phoneNumber}</p>
        <p className="text-stone-500 text-sm font-bold">
          No license submitted. FoodyzzHQ can request one from the order card at delivery.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white border-4 border-black p-6 shadow-brutalist space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-black uppercase text-lg">{customer.name || 'Unnamed'}</h3>
          <a href={`tel:${customer.phoneNumber}`} className="font-mono text-xs text-stone-500 hover:text-brand-green-dark flex items-center gap-1 mt-0.5">
            <Phone size={11} /> {customer.phoneNumber}
          </a>
          <p className="font-mono text-[11px] text-stone-400 mt-1">{customer.address}</p>
        </div>
        <StatusPill bucket={bucketOf(customer)} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {(['front', 'back'] as const).map(side => (
          <div key={side}>
            <p className="font-black uppercase text-[9px] tracking-widest text-stone-400 mb-1">{side}</p>
            <div className="border-2 border-black bg-stone-100 aspect-[16/10] flex items-center justify-center overflow-hidden">
              {urls[side] ? (
                <a href={urls[side]} target="_blank" rel="noreferrer" className="w-full h-full">
                  <img src={urls[side]} alt={`License ${side}`} className="w-full h-full object-cover" />
                </a>
              ) : (
                <Contact size={28} className="text-stone-300" />
              )}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] font-mono text-stone-400">Click an image to open it full size in a new tab.</p>

      {dl.rejectedReason && (
        <div className="border-2 border-rose-300 bg-rose-50 p-3">
          <p className="font-black uppercase text-[9px] tracking-widest text-rose-600 mb-1">Previously rejected</p>
          <p className="text-xs font-bold text-rose-700">{dl.rejectedReason}</p>
        </div>
      )}

      {dl.reviewedAt ? (
        <div className="border-2 border-emerald-300 bg-emerald-50 p-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-600" />
          <p className="text-xs font-bold text-emerald-700">
            Verified {new Date(dl.reviewedAt).toLocaleString()} by {dl.reviewedBy || 'staff'}
          </p>
        </div>
      ) : (
        <div className="space-y-3 border-t-2 border-stone-100 pt-4">
          <button
            onClick={() => decide(true)}
            disabled={busy}
            className="w-full bg-black text-white font-black uppercase text-sm py-3 border-2 border-black shadow-brutalist hover:bg-emerald-600 transition-colors disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Approve license'}
          </button>
          <div className="flex gap-2">
            <input
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              placeholder="Reason for rejection (shown to the customer)"
              className="flex-1 border-2 border-black px-3 py-2 font-mono text-xs focus:outline-none focus:border-rose-500"
            />
            <button
              onClick={() => decide(false)}
              disabled={busy}
              className="px-4 border-2 border-black font-black uppercase text-[10px] tracking-widest text-rose-600 hover:bg-rose-600 hover:text-white transition-colors disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
