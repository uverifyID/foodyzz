// Customer verification for Rent / Rent to Buy — the admin console's copy of the
// FoodyzzHQ Verifications screen (foodyzzhq/src/screens/VerificationsScreen.tsx +
// components/CustomerVerificationPanel.tsx). Same callables, same decisions:
//   identity — the Didit result, or a manual licence + selfie upload to approve;
//   address  — auto when the ID's ZIP matches, else a proof of address to approve;
//   location — the phone's GPS vs the delivery address, plus the IP lookup; staff
//              can override a failed check.
// The record lives in customerKyc/{phone} (server-only) and the status on
// users/{phone}.verification (server-written), so everything here goes through
// adminGetCustomerVerification / adminReviewCustomerVerification.
//
// The Licenses tab (manual document review) is still the fallback: an approval
// there counts towards identity and address too (customerVerification.ts
// syncDocumentReviews).
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck, Search, RefreshCw, Phone, ScanFace, FileText, MapPin } from 'lucide-react';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { getStorage, ref, getDownloadURL } from 'firebase/storage';
import { db, callable } from '../../firebase';

type Filter = 'in_review' | 'action_required' | 'verified';
type Target = 'identity' | 'address' | 'location';

const FILTER_LABEL: Record<Filter, string> = {
  in_review: 'Needs review',
  action_required: 'In progress',
  verified: 'Verified',
};

const STATE_LABEL: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', failed: 'Didit declined', in_review: 'Needs review',
  rejected: 'Rejected', verified: 'Verified', waiting: 'Waiting on ID', needs_document: 'Needs document',
  too_far: 'Too far', action_required: 'Customer to act',
};

function Pill({ state }: { state?: string }) {
  const s = String(state || '');
  const style = s === 'verified' ? 'bg-emerald-100 text-emerald-700'
    : s === 'in_review' ? 'bg-amber-100 text-amber-700'
      : ['failed', 'rejected', 'too_far'].includes(s) ? 'bg-rose-100 text-rose-700'
        : 'bg-stone-100 text-stone-500';
  return (
    <span className={`shrink-0 px-2 py-1 border-2 border-black font-black uppercase text-[8px] tracking-widest ${style}`}>
      {STATE_LABEL[s] ?? (s || '—')}
    </span>
  );
}

export default function VerificationsTab() {
  const [filter, setFilter] = useState<Filter>('in_review');
  const [rows, setRows] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [lookup, setLookup] = useState('');

  // Its own bounded listener rather than the full customer list: equality on a
  // server-written field, served by the automatic single-field index.
  useEffect(() => {
    setRows(null);
    const q = query(collection(db, 'users'), where('verification.status', '==', filter), limit(100));
    return onSnapshot(q,
      (snap) => setRows(snap.docs.map((d) => ({ phone: d.id, ...(d.data() as any) }))
        .sort((a, b) => String(b.verification?.updatedAt ?? '').localeCompare(String(a.verification?.updatedAt ?? '')))),
      () => setRows([]));
  }, [filter]);

  // Open any customer by phone — e.g. one who never started, to override location.
  const openLookup = () => {
    const digits = lookup.replace(/[^\d+]/g, '');
    if (!digits) return;
    setSelected(digits.startsWith('+') ? digits : `+1${digits.replace(/^1(?=\d{10}$)/, '')}`);
  };

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-black uppercase tracking-tighter italic">Verification</h2>
        <p className="text-stone-500 text-sm font-bold uppercase font-mono">
          Identity · proof of address · sign-up location — required for Rent and Rent to Buy
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setSelected(null); }}
            className={`px-4 py-2 border-2 border-black font-black uppercase text-[10px] tracking-widest transition-all ${
              filter === f ? 'bg-brand-green text-black shadow-brutalist' : 'bg-white hover:bg-stone-50'
            }`}
          >
            {FILTER_LABEL[f]}{filter === f && rows ? ` (${rows.length}${rows.length === 100 ? '+' : ''})` : ''}
          </button>
        ))}
      </div>

      <div className="relative max-w-md flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={lookup}
            onChange={(e) => setLookup(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') openLookup(); }}
            placeholder="Open a customer by phone…"
            className="w-full border-2 border-black pl-9 pr-3 py-2 font-mono text-sm focus:outline-none focus:border-brand-green"
          />
        </div>
        <button onClick={openLookup} className="px-4 border-2 border-black font-black uppercase text-[10px] tracking-widest bg-white hover:bg-stone-50">
          Open
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-3 lg:col-span-1">
          {rows === null && <p className="font-black uppercase text-xs text-stone-400">Loading…</p>}
          {rows?.map((c) => {
            const v = c.verification ?? {};
            const review = (['identity', 'address', 'location'] as const).filter((p) => v[p] === 'in_review');
            return (
              <button
                key={c.phone}
                onClick={() => setSelected(c.phone)}
                className={`w-full text-left bg-white border-2 border-black p-4 shadow-brutalist transition-colors ${
                  selected === c.phone ? 'bg-brand-green/10' : 'hover:bg-stone-50'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-black uppercase text-xs truncate">{c.name || 'Unnamed'}</h4>
                    <p className="text-[10px] font-mono text-stone-400">{c.phone}{c.workerId ? ` · ${c.workerId}` : ''}</p>
                  </div>
                  <Pill state={v.status} />
                </div>
                <p className="text-[10px] font-mono text-stone-500 mt-2 truncate">
                  {review.length ? `Review: ${review.join(', ')}`
                    : v.location === 'too_far' ? 'Location too far — override?'
                      : `ID ${STATE_LABEL[v.identity] ?? '—'} · address ${STATE_LABEL[v.address] ?? '—'} · location ${STATE_LABEL[v.location] ?? '—'}`}
                </p>
              </button>
            );
          })}
          {rows?.length === 0 && (
            <div className="p-12 text-center border-4 border-dashed border-stone-200">
              <ShieldCheck size={40} className="mx-auto text-stone-200 mb-3" />
              <p className="text-stone-400 font-black uppercase text-xs tracking-widest">Nothing here</p>
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          {selected ? <VerificationDetail key={selected} phone={selected} /> : (
            <div className="p-20 text-center border-4 border-dashed border-stone-200 h-full flex flex-col items-center justify-center">
              <ShieldCheck size={48} className="text-stone-200 mb-4" />
              <p className="text-stone-400 font-black uppercase text-xs tracking-widest">Select a customer to review</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v?: React.ReactNode }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <div className="flex justify-between gap-4 py-1 border-b border-stone-100 text-xs">
      <span className="font-black uppercase text-[10px] text-stone-400">{k}</span>
      <span className="font-bold text-right">{v}</span>
    </div>
  );
}

// A storage path from a manual submission. The admin claim reads these folders.
function DocImage({ path, label }: { path?: string; label: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUrl(null); setFailed(false);
    if (!path) return;
    getDownloadURL(ref(getStorage(), path))
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [path]);
  if (!path) return null;
  return (
    <div>
      <p className="font-black uppercase text-[9px] tracking-widest text-stone-400 mb-1">{label}</p>
      <div className="border-2 border-black bg-stone-100 aspect-[16/10] flex items-center justify-center overflow-hidden">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="w-full h-full">
            <img src={url} alt={label} className="w-full h-full object-contain" />
          </a>
        ) : <p className="font-black uppercase text-[9px] text-stone-400">{failed ? 'Could not load' : 'Loading…'}</p>}
      </div>
    </div>
  );
}

// A staff re-request (Rentals tab → Request ID check / proof of address).
function Requested({ req }: { req?: any }) {
  if (!req?.requestedAt) return null;
  return (
    <p className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border-2 border-indigo-200 p-2">
      Asked for again on {new Date(req.requestedAt).toLocaleString()}
      {req.requestedBy ? ` by ${req.requestedBy}` : ''}
      {req.orderId ? ` · ${String(req.orderId).replace('order_', '#')}` : ''}
      {req.note ? ` — ${req.note}` : ''}
      . Anything below it was already on file when staff asked, so it no longer counts.
    </p>
  );
}

function Section({ icon, title, state, children }: { icon: React.ReactNode; title: string; state?: string; children: React.ReactNode }) {
  return (
    <div className="border-2 border-black p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="flex items-center gap-2 font-black uppercase text-xs tracking-widest">{icon} {title}</h4>
        <Pill state={state} />
      </div>
      {children}
    </div>
  );
}

function VerificationDetail({ phone }: { phone: string }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await callable('adminGetCustomerVerification')({ phone });
      setData(res.data);
    } catch (e: any) {
      setData(null);
      setError(e?.code === 'functions/not-found' ? 'No customer with that phone number.' : (e?.message || 'Could not load verification.'));
    }
  }, [phone]);
  useEffect(() => { load(); }, [load]);

  const decide = async (target: Target, decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !note.trim()) {
      alert('Write a note first — the customer sees it and it tells them what to fix.');
      return;
    }
    const what = target === 'identity' ? 'the ID photos' : target === 'address' ? 'the proof of address' : 'the sign-up location';
    if (!window.confirm(`${decision === 'approved' ? 'Approve' : 'Reject'} ${what}? The customer is notified.`)) return;
    setBusy(`${target}:${decision}`);
    try {
      await callable('adminReviewCustomerVerification')({ phone, target, decision, note: note.trim() || undefined });
      setNote('');
      await load();
    } catch (e: any) {
      alert(e?.message || 'Could not save the decision.');
    } finally {
      setBusy(null);
    }
  };

  const Buttons = ({ target, approveLabel = 'Approve', canReject = true }: { target: Target; approveLabel?: string; canReject?: boolean }) => (
    <div className="flex gap-2 pt-2">
      <button
        onClick={() => decide(target, 'approved')}
        disabled={!!busy}
        className="flex-1 bg-black text-white font-black uppercase text-xs py-2.5 border-2 border-black shadow-brutalist hover:bg-emerald-600 transition-colors disabled:opacity-50"
      >
        {busy === `${target}:approved` ? 'Saving…' : approveLabel}
      </button>
      {canReject && (
        <button
          onClick={() => decide(target, 'rejected')}
          disabled={!!busy}
          className="px-4 border-2 border-black font-black uppercase text-[10px] tracking-widest text-rose-600 hover:bg-rose-600 hover:text-white transition-colors disabled:opacity-50"
        >
          {busy === `${target}:rejected` ? 'Saving…' : 'Reject'}
        </button>
      )}
    </div>
  );

  if (error) {
    return (
      <div className="bg-white border-4 border-black p-6 shadow-brutalist">
        <p className="font-mono text-xs text-stone-400 mb-2">{phone}</p>
        <p className="text-rose-600 text-sm font-bold">{error}</p>
      </div>
    );
  }
  if (!data) return <div className="bg-white border-4 border-black p-6 shadow-brutalist font-black uppercase text-xs text-stone-400">Loading…</div>;

  const v = data.verification ?? {};
  const k = data.kyc ?? {};
  const d = k.didit ?? {};
  const loc = k.location?.forAddress === data.currentAddress ? k.location : null;
  const ipl = loc?.ipLocation;
  // A staff re-request retires everything below it until the customer sends
  // something newer — say so, or the Didit record reads as still current.
  const requests = k.requests ?? {};
  const idReview = k.identityReview;
  const addrReview = k.addressReview?.forAddress === data.currentAddress ? k.addressReview : null;
  const locReview = k.locationReview?.forAddress === data.currentAddress ? k.locationReview : null;
  const [address, zip] = String(data.currentAddress || '').split('|');

  return (
    <div className="bg-white border-4 border-black p-6 shadow-brutalist space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <a href={`tel:${phone}`} className="font-mono text-xs text-stone-500 hover:text-brand-green-dark flex items-center gap-1">
            <Phone size={11} /> {phone}
          </a>
          <p className="font-mono text-[11px] text-stone-400 mt-1">{address || 'No delivery address'}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pill state={v.status} />
          <button onClick={load} title="Refresh" className="p-1 text-stone-500 hover:text-black"><RefreshCw size={14} /></button>
        </div>
      </div>
      {!data.required && (
        <p className="text-[11px] font-bold text-amber-700 bg-amber-50 border-2 border-amber-300 p-2">
          The checkout gate is OFF (Settings → apiConfig/global.verification.required) — customers can still rent without this.
        </p>
      )}

      <Section icon={<ScanFace size={14} />} title="Identity" state={v.identity}>
        <Requested req={requests.identity} />
        {data.portrait && (
          <a href={data.portrait} target="_blank" rel="noreferrer">
            <img src={data.portrait} alt="Didit selfie" className="w-28 h-28 object-cover border-2 border-black" />
          </a>
        )}
        <Row k="Didit" v={d.status} />
        <Row k="Legal name" v={[d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ')} />
        <Row k="Date of birth" v={d.dateOfBirth} />
        <Row k="Document" v={[d.documentType, d.issuingState].filter(Boolean).join(' · ')} />
        <Row k="Expires" v={d.documentExpiry} />
        <Row k="ID address" v={d.idAddress} />
        <Row k="Liveness / face match" v={d.livenessScore != null || d.faceMatchScore != null ? `${d.livenessScore ?? '—'} / ${d.faceMatchScore ?? '—'}` : undefined} />
        <Row k="Didit IP" v={[d.ipCity, d.ipState, d.ipCountry].filter(Boolean).join(', ') + (d.vpn ? ' · VPN' : '') + (d.proxy ? ' · proxy' : '')} />
        {d.warnings?.length ? <p className="text-[11px] font-bold text-amber-700">Warnings: {d.warnings.join(', ')}</p> : null}
        {idReview?.licenseFront && (
          <>
            <p className="font-black uppercase text-[9px] tracking-widest text-stone-500 pt-2">
              {idReview.source === 'documents' ? 'Uploaded documents' : 'Manual upload'} · {idReview.status}
              {idReview.reviewedBy ? ` by ${idReview.reviewedBy}` : ''}{idReview.note ? ` — ${idReview.note}` : ''}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <DocImage path={idReview.licenseFront} label="Licence front" />
              <DocImage path={idReview.licenseBack} label="Licence back" />
              <DocImage path={idReview.selfie} label="Selfie" />
            </div>
          </>
        )}
        {v.identity === 'in_review' && idReview?.status === 'submitted' && <Buttons target="identity" />}
        {v.identity === 'in_review' && idReview?.status !== 'submitted' && (
          <p className="text-[11px] font-bold text-stone-500">Didit sent this to manual review — decide it in the Didit console (business.didit.me).</p>
        )}
      </Section>

      <Section icon={<FileText size={14} />} title="Proof of address" state={v.address}>
        <Requested req={requests.address} />
        <Row k="Delivery ZIP / ID ZIP" v={`${zip || '—'} / ${d.idZip || '—'}`} />
        {addrReview?.document && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DocImage path={addrReview.document} label={`Document · ${addrReview.status}`} />
          </div>
        )}
        {addrReview?.note ? <p className="text-[11px] font-bold text-stone-500">Note: {addrReview.note}</p> : null}
        {v.address === 'in_review' && <Buttons target="address" />}
        {(v.address === 'needs_document' || v.address === 'waiting') && v.identity === 'verified' && (
          <Buttons target="address" approveLabel="Approve without a document" canReject={false} />
        )}
      </Section>

      <Section icon={<MapPin size={14} />} title="Sign-up location" state={v.location}>
        {loc ? (
          <>
            <Row k="Distance" v={typeof loc.distanceMiles === 'number' ? `${loc.distanceMiles} mi (limit ${data.radiusMiles} mi)` : 'No map coordinates on the delivery address'} />
            <Row k="GPS accuracy" v={loc.accuracyM != null ? `±${Math.round(loc.accuracyM)} m` : undefined} />
            <Row k="Captured" v={loc.capturedAt ? new Date(loc.capturedAt).toLocaleString() : undefined} />
            <Row k="IP" v={loc.ip} />
            <Row k="IP location" v={ipl ? [ipl.city, ipl.region, ipl.countryCode || ipl.country].filter(Boolean).join(', ') + (ipl.proxy ? ' · PROXY' : '') : 'Lookup unavailable'} />
            <Row k="Network" v={ipl?.network} />
            <a
              className="inline-block text-[10px] font-black uppercase text-indigo-700 hover:underline"
              target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&origin=${loc.deviceLat},${loc.deviceLng}` +
                (typeof loc.addressLat === 'number' ? `&destination=${loc.addressLat},${loc.addressLng}` : '')}
            >
              Phone → delivery address in Google Maps
            </a>
          </>
        ) : <p className="text-[11px] font-bold text-stone-400">No location check for the current delivery address yet.</p>}
        {locReview && (
          <p className="text-[11px] font-bold text-stone-500">
            Staff {locReview.status} by {locReview.reviewedBy}{locReview.note ? ` — ${locReview.note}` : ''}
          </p>
        )}
        {v.location !== 'verified' && <Buttons target="location" approveLabel="Override · approve" canReject={!!loc} />}
      </Section>

      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={500}
        rows={2}
        placeholder="Note to the customer (required to reject)"
        className="w-full border-2 border-black px-3 py-2 font-mono text-xs focus:outline-none focus:border-brand-green"
      />
    </div>
  );
}
