import React, { useMemo, useState } from 'react';
import { db, callable } from '../../firebase';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { RentalOrder, LogisticsConfig, OrderStatus } from '../../types';
import { Activity, MapPin, DollarSign, Bike, ShieldCheck, AlertCircle, Clock, ScanFace, FileText, XCircle } from 'lucide-react';

interface OperationsTabProps {
  logistics: LogisticsConfig | null;
}

// The buckets an operator actually works from, mirroring the FoodyzzHQ tabs:
// a rental is either waiting to go out (Delivery) or already out and owed (Rental Due).
type Bucket = 'all' | 'delivery' | 'rentalDue' | 'overdue' | 'completed';

const BUCKET_LABEL: Record<Bucket, string> = {
  all: 'All',
  delivery: 'Delivery',
  rentalDue: 'Rental Due',
  overdue: 'Overdue',
  completed: 'Completed',
};

const RENTAL_TYPE_LABEL: Record<string, string> = {
  rent: 'Rent',
  rentToBuy: 'Rent to Buy',
  buy: 'Buy',
};

const todayDay = (): string => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// A rental is "delivered" once the payment has been captured — that is the moment
// the bike physically changes hands and the charge is taken (see markRentalDelivered).
const isDelivered = (o: RentalOrder) =>
  o.paymentCaptured === true || ['delivered', 'completed'].includes(o.status);

// Nothing left to cancel once the bike has gone out or the rental is already off
// the books — cancelOrder refuses these too.
const isTerminal = (o: RentalOrder) =>
  [OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.CANCELLED].includes(o.status);

// Both the app and the console store the customer in E.164; normalize anyway, since
// the verification callables match on it strictly.
const e164 = (phone?: string): string | null => {
  const s = String(phone ?? '').replace(/[^\d+]/g, '');
  if (s.startsWith('+')) return /^\+\d{8,15}$/.test(s) ? s : null;
  const d = s.replace(/\D/g, '');
  return d.length === 10 ? `+1${d}` : d.length === 11 && d.startsWith('1') ? `+${d}` : null;
};

const askedOn = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : null);

const bucketOf = (o: RentalOrder, today: string): Bucket => {
  if (o.status === OrderStatus.CANCELLED) return 'all';
  if (o.status === OrderStatus.DELIVERED && o.completedAt) return 'completed';
  if (!isDelivered(o)) return 'delivery';
  if (o.expectedEndDate && o.expectedEndDate < today) return 'overdue';
  return 'rentalDue';
};

export default function OperationsTab({ logistics }: OperationsTabProps) {
  const [orders, setOrders] = useState<RentalOrder[]>([]);
  const [bucket, setBucket] = useState<Bucket>('all');
  // One action at a time per card, keyed `${orderId}:${action}`.
  const [busy, setBusy] = useState<string | null>(null);

  // Cancelling releases the authorization hold, frees a reserved bike and tells the
  // customer why — all of that is cancelOrder's job, so the console only asks.
  const cancel = async (order: RentalOrder) => {
    const reason = window.prompt(
      `Cancel ${order.id.replace('order_', '#')} for ${order.customerName}?\n\n` +
      'The customer is notified with the reason below, any hold on their card is released ' +
      'and a reserved bike goes back into stock.',
      'Cancelled by FoodyzzHQ',
    );
    if (reason === null) return;
    setBusy(`${order.id}:cancel`);
    try {
      await callable('cancelOrder')({ orderId: order.id, reason: reason.trim() || undefined });
    } catch (e: any) {
      alert(e?.message || 'Could not cancel this rental.');
    } finally {
      setBusy(null);
    }
  };

  // Asks the renter to redo one check. The decision stays in the app — this puts the
  // ID check or the proof-of-address upload back in front of them and pushes them.
  const request = async (order: RentalOrder, target: 'identity' | 'address') => {
    const phone = e164(order.customerPhone);
    if (!phone) {
      alert('This rental has no usable customer phone number, so the customer cannot be reached.');
      return;
    }
    const what = target === 'identity' ? 'redo their ID check' : 'upload a proof of address';
    const note = window.prompt(
      `Ask ${order.customerName} to ${what}?\n\n` +
      'They are notified and the step reopens in the Foodyzz app. Anything you write here is ' +
      'shown to them — leave it empty to send the standard wording.',
      '',
    );
    if (note === null) return;
    setBusy(`${order.id}:${target}`);
    try {
      await callable('adminRequestCustomerVerification')({
        phone, target, orderId: order.id, note: note.trim() || undefined,
      });
    } catch (e: any) {
      alert(e?.message || 'Could not send the request.');
    } finally {
      setBusy(null);
    }
  };

  React.useEffect(() => {
    const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'), limit(50));
    return onSnapshot(q, (snap) => {
      setOrders(snap.docs.map(d => ({ ...d.data(), id: d.id } as RentalOrder)));
    });
  }, []);

  const today = todayDay();
  const counts = useMemo(() => {
    const c: Record<Bucket, number> = { all: orders.length, delivery: 0, rentalDue: 0, overdue: 0, completed: 0 };
    orders.forEach(o => {
      const b = bucketOf(o, today);
      if (b !== 'all') c[b] += 1;
    });
    return c;
  }, [orders, today]);

  const visible = bucket === 'all' ? orders : orders.filter(o => bucketOf(o, today) === bucket);

  const modelName = (model?: number) =>
    logistics?.bikeModels.find(m => m.model === model)?.name ?? (model ? `Model ${model}` : 'Bike');

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-black uppercase tracking-tighter italic">Rentals</h2>
        <p className="text-stone-500 text-sm font-bold uppercase font-mono">Live rental stream</p>
      </header>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(BUCKET_LABEL) as Bucket[]).map(b => (
          <button
            key={b}
            onClick={() => setBucket(b)}
            className={`px-4 py-2 border-2 border-black font-black uppercase text-[10px] tracking-widest transition-all ${
              bucket === b ? 'bg-brand-green text-black shadow-brutalist' : 'bg-white hover:bg-stone-50'
            }`}
          >
            {BUCKET_LABEL[b]} ({counts[b]})
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4">
        {visible.map(order => {
          const overdue = bucketOf(order, today) === 'overdue';
          const delivered = isDelivered(order);
          return (
            <div key={order.id} className="bg-white border-4 border-black p-6 shadow-brutalist relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-2 h-full ${
                order.status === OrderStatus.CANCELLED ? 'bg-rose-500' :
                overdue ? 'bg-rose-500' :
                order.status === OrderStatus.DELIVERED ? 'bg-emerald-500' :
                'bg-brand-green animate-pulse'
              }`} />

              <div className="flex flex-col md:flex-row justify-between gap-6">
                <div className="space-y-4 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-black uppercase bg-stone-100 px-2 py-1 border-2 border-black">
                      {order.id.replace('order_', '#')}
                    </span>
                    <span className={`text-[10px] font-black uppercase px-2 py-1 border-2 border-black ${
                      order.status === OrderStatus.CANCELLED ? 'bg-rose-100 text-rose-600' :
                      order.status === OrderStatus.DELIVERED ? 'bg-emerald-100 text-emerald-600' :
                      'bg-amber-100 text-amber-600'
                    }`}>
                      {order.status}
                    </span>
                    <span className="text-[10px] font-black uppercase px-2 py-1 border-2 border-black bg-indigo-100 text-indigo-700 flex items-center gap-1">
                      <Bike size={11} /> {RENTAL_TYPE_LABEL[order.rentalType || 'rent'] ?? 'Rent'}
                    </span>
                    {overdue && (
                      <span className="text-[10px] font-black uppercase px-2 py-1 border-2 border-black bg-rose-100 text-rose-600 flex items-center gap-1">
                        <AlertCircle size={11} /> Overdue
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field label="Customer" value={order.customerName} />
                    <Field label="Bike" value={`${modelName(order.bikeModel)}${order.bikeNo ? ` · #${order.bikeNo}` : ''}`} />
                    <Field
                      label="Term"
                      value={order.durationValue ? `${order.durationValue} ${order.durationUnit || ''}` : '—'}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <Field
                      label="Delivery"
                      value={`${order.startDate || '—'}${order.deliveryTime ? ` · ${order.deliveryTime}` : ''}`}
                      icon={<Clock size={12} />}
                    />
                    <Field label="Due back" value={order.expectedEndDate || '—'} />
                    <Field label="Location" value={order.providerName || 'PENDING'} />
                  </div>

                  <div className="flex items-start gap-2 text-stone-500">
                    <MapPin size={14} className="shrink-0 mt-0.5" />
                    <p className="text-[10px] font-bold uppercase leading-tight">{order.customerAddress}</p>
                  </div>
                </div>

                <div className="md:text-right space-y-4 min-w-[160px]">
                  <div>
                    <span className="text-[8px] font-black text-stone-400 uppercase tracking-widest block">
                      {delivered ? 'Charged' : 'Authorized'}
                    </span>
                    <p className="text-2xl font-black tracking-tighter">
                      ${(order.chargedAmount ?? order.finalPrice ?? order.estimatedPrice ?? 0).toFixed(2)}
                    </p>
                  </div>

                  {/* The deposit never appears on the rental invoice — it is charged as a
                      separate transaction at delivery and refunded (minus any damage
                      adjustments) when the rental completes. */}
                  {(order.depositAmount ?? 0) > 0 && (
                    <div>
                      <span className="text-[8px] font-black text-stone-400 uppercase tracking-widest block">Deposit</span>
                      <p className="text-sm font-black">
                        ${Number(order.depositAmount).toFixed(2)}{' '}
                        <span className={`text-[9px] uppercase ${
                          order.depositStatus === 'refunded' || order.depositStatus === 'released' ? 'text-emerald-600' :
                          order.depositStatus === 'charged' ? 'text-indigo-600' :
                          order.depositStatus === 'secured' ? 'text-amber-600' : 'text-stone-400'
                        }`}>
                          {order.depositStatus === 'charged' ? 'held' : order.depositStatus || 'not charged'}
                        </span>
                      </p>
                      {order.depositStatus === 'refunded' && (
                        <p className="text-[9px] font-mono text-stone-400">
                          refunded ${Number(order.depositRefundedAmount ?? 0).toFixed(2)}
                          {(order.depositAdjustmentTotal ?? 0) > 0 ? ` · adj −$${Number(order.depositAdjustmentTotal).toFixed(2)}` : ''}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="flex md:justify-end gap-2">
                    <div className="p-2 bg-stone-100 border-2 border-black rounded" title={delivered ? 'Payment captured' : 'Not charged yet'}>
                      <DollarSign size={16} className={delivered ? 'text-emerald-500' : 'text-stone-300'} />
                    </div>
                    <div className="p-2 bg-stone-100 border-2 border-black rounded" title={order.deliveryTimeConfirmedAt ? 'Delivery time confirmed' : 'Delivery time not confirmed'}>
                      <ShieldCheck size={16} className={order.deliveryTimeConfirmedAt ? 'text-emerald-500' : 'text-stone-300'} />
                    </div>
                  </div>
                </div>
              </div>

              {/* The three things an operator does to a live rental from here. The
                  verification requests only ASK — approving an ID or a proof of
                  address stays in the app (FoodyzzHQ → Verifications). */}
              <div className="mt-5 pt-4 border-t-2 border-dashed border-stone-200 flex flex-wrap gap-2">
                <CardButton
                  icon={<XCircle size={13} />}
                  label={order.status === OrderStatus.CANCELLED ? 'Cancelled' : 'Cancel rental'}
                  busy={busy === `${order.id}:cancel`}
                  disabled={!!busy || isTerminal(order)}
                  onClick={() => cancel(order)}
                  tone="danger"
                  title={isTerminal(order) ? 'This rental is already closed' : undefined}
                />
                <CardButton
                  icon={<ScanFace size={13} />}
                  label="Request ID check"
                  sub={askedOn(order.verificationRequests?.identity?.requestedAt)}
                  busy={busy === `${order.id}:identity`}
                  disabled={!!busy}
                  onClick={() => request(order, 'identity')}
                />
                <CardButton
                  icon={<FileText size={13} />}
                  label="Request proof of address"
                  sub={askedOn(order.verificationRequests?.address?.requestedAt)}
                  busy={busy === `${order.id}:address`}
                  disabled={!!busy}
                  onClick={() => request(order, 'address')}
                />
              </div>
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="p-20 text-center border-4 border-dashed border-stone-200 rounded-lg">
            <Activity size={48} className="mx-auto text-stone-200 mb-4" />
            <p className="text-stone-400 font-black uppercase text-sm tracking-widest">No rentals in this view</p>
          </div>
        )}
      </div>
    </div>
  );
}

function CardButton({ icon, label, sub, busy, disabled, onClick, tone, title }: {
  icon: React.ReactNode; label: string; sub?: string | null; busy?: boolean; disabled?: boolean;
  onClick: () => void; tone?: 'danger'; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      title={title}
      className={`flex items-center gap-2 px-3 py-2 border-2 border-black font-black uppercase text-[10px] tracking-widest transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        tone === 'danger' ? 'text-rose-600 bg-white hover:bg-rose-600 hover:text-white' : 'bg-white hover:bg-brand-green'
      }`}
    >
      {icon}
      {busy ? 'Sending…' : label}
      {/* When it was last asked for, so nobody nudges the same renter twice a day. */}
      {!busy && sub && <span className="font-mono text-[9px] text-stone-400 normal-case tracking-normal">asked {sub}</span>}
    </button>
  );
}

function Field({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <span className="text-[8px] font-black text-stone-400 uppercase tracking-widest flex items-center gap-1">
        {icon}{label}
      </span>
      <p className="text-sm font-black uppercase truncate">{value}</p>
    </div>
  );
}
