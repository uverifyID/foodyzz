// Friendly two-part schedule formatting for the provider order cards.
// Reads the new handoff*/needBy* fields, falling back to the legacy
// pickupDay/pickupTimeWindow + needBy ISO so pre-redesign orders still render.

// YYYY-MM-DD (local) → "Today" / "Tomorrow" / "Mon, Jul 1". Non-date labels pass through.
const fmtDay = (day?: string | null): string => {
  if (!day) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day; // already a label (legacy)
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return day;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

const joinDayTime = (day: string, time?: string | null): string =>
  [fmtDay(day), time].filter(Boolean).join(' · ') || day;

export type ScheduleLine = { label: string; value: string };

// Both of an order's scheduled days as LOCAL-midnight Dates, for tab filtering
// and day-highlighting: `start` = handoff (drop-off / pickup) day, `end` =
// need-by (ready / deliver-by) day. Handles absolute YYYY-MM-DD, legacy
// Today/Tomorrow labels, the needBy ISO string, and Firestore timestamps.
export function getOrderDates(order: any): { start: Date | null; end: Date | null } {
  const parse = (src: any): Date | null => {
    if (!src) return null;
    if (typeof src === 'string') {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (src.includes('Today')) return today;
      if (src.includes('Tomorrow')) { const t = new Date(today); t.setDate(today.getDate() + 1); return t; }
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(src);
      const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(src);
      if (isNaN(d.getTime())) return null;
      d.setHours(0, 0, 0, 0);
      return d;
    }
    if (src.seconds) { const d = new Date(src.seconds * 1000); d.setHours(0, 0, 0, 0); return d; }
    return null;
  };
  return {
    start: parse(order.handoffDay ?? order.pickupDay),
    end: parse(order.needByDay ?? order.needBy),
  };
}

// Two labeled lines for the card. Every Foodyzz order is a bike delivery, so the
// first line is the delivery slot (startDate + deliveryTime) and the second is the
// due-back date (expectedEndDate). Falls back to the legacy handoff/need-by fields
// for any pre-rewrite order still in the collection.
export function getScheduleLines(order: any): { handoff: ScheduleLine; needBy: ScheduleLine } {
  const deliveryDay = order.startDate ?? order.handoffDay ?? order.pickupDay ?? null;
  const deliveryTime = order.deliveryTime ?? order.handoffTime ?? order.pickupTimeWindow ?? null;
  const deliveryStr = deliveryDay ? joinDayTime(deliveryDay, deliveryTime) : '—';

  const dueDay = order.expectedEndDate ?? order.needByDay ?? null;
  const dueStr = dueDay
    ? joinDayTime(dueDay, order.needByTime)
    : (() => {
        if (!order.needBy) return 'TBD';
        const d = new Date(order.needBy);
        return isNaN(d.getTime())
          ? String(order.needBy)
          : d.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      })();

  return {
    handoff: { label: 'Delivery', value: deliveryStr },
    needBy: { label: 'Due back', value: dueStr },
  };
}
