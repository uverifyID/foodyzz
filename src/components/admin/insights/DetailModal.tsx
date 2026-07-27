import React from 'react';
import { X, AlertCircle } from 'lucide-react';
import { RentalOrder } from '../../../types';
import { FeeComponent, KIND_LABEL, Txn, TxnColumn, money, shortDate } from './ledger';

interface DetailModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  // Exactly one of these. Money cards drill into the transactions behind the figure;
  // program-health cards drill into the rentals behind the count.
  txns?: Txn[];
  orders?: RentalOrder[];
  /** Extra note under the heading — e.g. what the column being drilled into means. */
  note?: string;
  /** The column this card is about. Tinted so the figure being explained is obvious. */
  highlight?: TxnColumn;
  /** What the headline is made of, itemised. Shown above the transactions. */
  breakdown?: FeeComponent[];
}

// Every transaction table is scrollable inside its own box, so a wide money table on a
// laptop never makes the whole modal scroll sideways.
export default function DetailModal({
  title, subtitle, onClose, txns, orders, note, highlight, breakdown,
}: DetailModalProps) {
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const estimatedCount = (txns || []).filter(t => t.estimated).length;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-start md:items-center justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white border-4 border-black shadow-brutalist w-full max-w-5xl my-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-start gap-4 border-b-4 border-black p-6">
          <div>
            <h3 className="text-xl font-black uppercase tracking-tighter italic">{title}</h3>
            {subtitle && <p className="text-sm font-black font-mono mt-1">{subtitle}</p>}
            {note && <p className="text-[10px] font-bold uppercase text-stone-500 mt-2 tracking-wider">{note}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 border-2 border-black bg-white hover:bg-stone-100 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {estimatedCount > 0 && (
          <div className="flex items-center gap-3 bg-yellow-50 border-b-4 border-yellow-400 px-6 py-3">
            <AlertCircle size={14} className="text-yellow-600 shrink-0" />
            <p className="text-[10px] font-bold font-mono text-yellow-800 uppercase">
              {estimatedCount} row{estimatedCount === 1 ? '' : 's'} marked EST — Stripe's balance transaction
              hasn't been read yet, so the fee is estimated from the configured rates. Run Sync Stripe to settle them.
            </p>
          </div>
        )}

        <div className="p-6 max-h-[65vh] overflow-y-auto space-y-6">
          {breakdown && breakdown.length > 0 && <Breakdown rows={breakdown} />}
          {txns && <TxnTable txns={txns} highlight={highlight} />}
          {orders && <OrderTable orders={orders} />}
        </div>
      </div>
    </div>
  );
}

// What the headline is made of. Each line is a fee TYPE, and they sum to the figure on
// the card — the residual line in feeBreakdown guarantees it, so this can be read as an
// itemisation rather than a sample.
function Breakdown({ rows }: { rows: FeeComponent[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <div className="border-2 border-black bg-stone-50">
      <p className="text-[9px] font-black uppercase tracking-widest text-stone-500 px-4 pt-3 pb-2">
        What made up this total
      </p>
      <table className="w-full text-left">
        <tbody className="divide-y divide-stone-200">
          {rows.map(r => (
            <tr key={r.label}>
              <td className="py-2.5 px-4 text-xs font-black uppercase">{r.label}</td>
              <td className="py-2.5 pr-4 text-[10px] font-mono text-stone-400 text-right whitespace-nowrap">
                {r.txns} charge{r.txns === 1 ? '' : 's'}
              </td>
              <td className="py-2.5 pr-4 text-right font-black text-xs whitespace-nowrap w-28">{money(r.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-black">
            <td className="py-2.5 px-4 text-[9px] font-black uppercase tracking-widest text-stone-400" colSpan={2}>
              Total
            </td>
            <td className="py-2.5 pr-4 text-right font-black text-sm whitespace-nowrap">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// Tint for the one column the card is about. Without it a nine-column reconciliation
// table gives no clue which number the figure you clicked actually lives in.
const hl = (col: TxnColumn, active?: TxnColumn) => (col === active ? 'bg-brand-green/10' : '');

function TxnTable({ txns, highlight }: { txns: Txn[]; highlight?: TxnColumn }) {
  if (txns.length === 0) {
    return <p className="text-stone-400 font-mono text-xs text-center py-10">No transactions in this range.</p>;
  }
  const total = (pick: (t: Txn) => number) => txns.reduce((s, t) => s + pick(t), 0);

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full min-w-[960px] text-left">
        <thead>
          <tr className="border-b-2 border-stone-200 text-[9px] font-black uppercase text-stone-400 tracking-widest">
            <th className="pb-3 pr-3">When</th>
            <th className="pb-3 pr-3">Type</th>
            <th className="pb-3 pr-3">Customer</th>
            <th className={`pb-3 pr-3 text-right ${hl('amount', highlight)}`}>We charged</th>
            <th className={`pb-3 pr-3 text-right ${hl('tax', highlight)}`}>Tax</th>
            <th className={`pb-3 pr-3 text-right ${hl('fees', highlight)}`}>Fees</th>
            <th className={`pb-3 pr-3 text-right ${hl('ccFee', highlight)}`}>Our card fee</th>
            <th className="pb-3 pr-3 text-right">Stripe took</th>
            <th className={`pb-3 pr-3 text-right ${hl('stripeNet', highlight)}`}>Stripe paid</th>
            <th className={`pb-3 text-right ${hl('spread', highlight)}`}>Difference</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {txns.map(t => (
            <tr key={t.id} className="align-top">
              <td className="py-3 pr-3 font-mono text-[11px] text-stone-500 whitespace-nowrap">{shortDate(t.at)}</td>
              <td className="py-3 pr-3">
                <span className="text-[9px] font-black uppercase px-2 py-1 border-2 border-black bg-stone-100 whitespace-nowrap">
                  {KIND_LABEL[t.kind]}
                </span>
                {t.estimated && (
                  <span className="ml-1 text-[9px] font-black uppercase px-1.5 py-1 border-2 border-yellow-400 bg-yellow-50 text-yellow-700">
                    EST
                  </span>
                )}
              </td>
              <td className="py-3 pr-3">
                <p className="text-xs font-black uppercase truncate max-w-[140px]">{t.customerName || '—'}</p>
                <p className="text-[9px] font-mono text-stone-400 truncate max-w-[140px]">
                  {t.orderId.replace('order_', '#')}
                </p>
              </td>
              <td className={`py-3 pr-3 text-right font-black text-xs whitespace-nowrap ${hl('amount', highlight)}`}>
                {money(t.amount)}
              </td>
              <td className={`py-3 pr-3 text-right font-mono text-[11px] text-stone-500 whitespace-nowrap ${hl('tax', highlight)}`}>
                {money(t.tax)}
              </td>
              <td className={`py-3 pr-3 text-right font-mono text-[11px] whitespace-nowrap ${hl('fees', highlight)} ${t.serviceFees ? '' : 'text-stone-300'}`}>
                {t.serviceFees ? money(t.serviceFees) : '—'}
              </td>
              <td className={`py-3 pr-3 text-right font-mono text-[11px] whitespace-nowrap ${hl('ccFee', highlight)}`}>
                {money(t.chargedCcFee)}
              </td>
              <td className="py-3 pr-3 text-right font-mono text-[11px] text-rose-600 whitespace-nowrap">
                −{money(t.stripeFeeResolved).replace('−', '')}
              </td>
              <td className={`py-3 pr-3 text-right font-black text-xs text-emerald-700 whitespace-nowrap ${hl('stripeNet', highlight)}`}>
                {money(t.stripeNetResolved)}
              </td>
              <td className={`py-3 text-right font-black text-xs whitespace-nowrap ${hl('spread', highlight)} ${t.spread < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {t.spread >= 0 ? '+' : ''}{money(t.spread)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-4 border-black text-xs font-black">
            <td className="pt-3 pr-3 uppercase text-[9px] tracking-widest text-stone-400" colSpan={3}>
              {txns.length} transaction{txns.length === 1 ? '' : 's'}
            </td>
            <td className={`pt-3 pr-3 text-right whitespace-nowrap ${hl('amount', highlight)}`}>{money(total(t => t.amount))}</td>
            <td className={`pt-3 pr-3 text-right whitespace-nowrap ${hl('tax', highlight)}`}>{money(total(t => t.tax))}</td>
            <td className={`pt-3 pr-3 text-right whitespace-nowrap ${hl('fees', highlight)}`}>{money(total(t => t.serviceFees))}</td>
            <td className={`pt-3 pr-3 text-right whitespace-nowrap ${hl('ccFee', highlight)}`}>{money(total(t => t.chargedCcFee))}</td>
            <td className="pt-3 pr-3 text-right text-rose-600 whitespace-nowrap">
              −{money(total(t => t.stripeFeeResolved)).replace('−', '')}
            </td>
            <td className={`pt-3 pr-3 text-right text-emerald-700 whitespace-nowrap ${hl('stripeNet', highlight)}`}>{money(total(t => t.stripeNetResolved))}</td>
            <td className={`pt-3 text-right whitespace-nowrap ${hl('spread', highlight)} ${total(t => t.spread) < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
              {total(t => t.spread) >= 0 ? '+' : ''}{money(total(t => t.spread))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function OrderTable({ orders }: { orders: RentalOrder[] }) {
  if (orders.length === 0) {
    return <p className="text-stone-400 font-mono text-xs text-center py-10">Nothing in this bucket — all clear.</p>;
  }
  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <table className="w-full min-w-[680px] text-left">
        <thead>
          <tr className="border-b-2 border-stone-200 text-[9px] font-black uppercase text-stone-400 tracking-widest">
            <th className="pb-3 pr-3">Order</th>
            <th className="pb-3 pr-3">Customer</th>
            <th className="pb-3 pr-3">Store</th>
            <th className="pb-3 pr-3">Status</th>
            <th className="pb-3 pr-3">Starts</th>
            <th className="pb-3 pr-3">Due back</th>
            <th className="pb-3 text-right">Deposit held</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {orders.map(o => (
            <tr key={o.id}>
              <td className="py-3 pr-3 font-mono text-[11px] whitespace-nowrap">{o.id.replace('order_', '#')}</td>
              <td className="py-3 pr-3 text-xs font-black uppercase truncate max-w-[160px]">{o.customerName || '—'}</td>
              <td className="py-3 pr-3 text-[11px] font-bold uppercase text-stone-500 truncate max-w-[140px]">
                {o.providerName || 'Pending'}
              </td>
              <td className="py-3 pr-3">
                <span className="text-[9px] font-black uppercase px-2 py-1 border-2 border-black bg-stone-100 whitespace-nowrap">
                  {o.status}
                </span>
              </td>
              <td className="py-3 pr-3 font-mono text-[11px] text-stone-500 whitespace-nowrap">{o.startDate || '—'}</td>
              <td className="py-3 pr-3 font-mono text-[11px] whitespace-nowrap">{o.expectedEndDate || '—'}</td>
              <td className="py-3 text-right font-black text-xs whitespace-nowrap">
                {Number(o.depositChargedAmount ?? 0) > 0 ? money(Number(o.depositChargedAmount)) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
