import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, ScrollView, FlatList, TouchableOpacity, ActivityIndicator, Alert, TextInput, Linking, Modal, Animated, Easing } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Truck, Clock, MessageSquare, Bell, MapPin, CheckCircle, RefreshCcw, Package, Phone, Search, X, Bike, QrCode, CreditCard, CalendarClock, User } from 'lucide-react-native';
import { COLORS } from '../theme';
import { db } from '../services/firebase';
import { useActiveProvider, useGlobalConfig, useProviderOrders } from '../hooks';
import { OrderStatus, RentalOrder } from '../types';
import { getScheduleLines, getOrderDates } from '../utils/schedule';
import { getCurrentProviderCoords, warnLocationUnavailableOnce } from '../utils/location';
import ProviderNotes from '../components/ProviderNotes';
import HandoverSheet from '../components/HandoverSheet';
import BikeAssignment from '../components/BikeAssignment';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/functions';

// A softly pulsing wrapper used to draw the eye to "customer reached out"
// indicators (header bell dot + card badge). Loops opacity until unmounted.
function Pulse({ children, style }: { children?: React.ReactNode; style?: any }) {
  // Lazy-init so we don't allocate a throwaway Animated.Value on every render.
  // React 19 removed the no-arg useRef<T>() overload; pass an explicit undefined.
  const opacityRef = useRef<Animated.Value | undefined>(undefined);
  if (!opacityRef.current) opacityRef.current = new Animated.Value(1);
  const opacity = opacityRef.current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.25, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return <Animated.View style={[{ opacity }, style]}>{children}</Animated.View>;
}

// Resolve an order's scheduled day to a Date for tab filtering. Handles:
//  - absolute 'YYYY-MM-DD' pickup days (parsed as LOCAL — new Date('YYYY-MM-DD')
//    is UTC midnight, which rolls back a day in western zones once normalized),
//  - legacy 'Today'/'Tomorrow' labels still present on older orders,
//  - full ISO needBy strings, and Firestore timestamps.
function resolveOrderDate(sourceDate: any, today: Date, tomorrow: Date): Date | null {
  if (!sourceDate) return null;
  if (typeof sourceDate === 'string') {
    if (sourceDate.includes('Today')) return new Date(today);
    if (sourceDate.includes('Tomorrow')) return new Date(tomorrow);
    const m = sourceDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const d = new Date(sourceDate);
    return isNaN(d.getTime()) ? null : d;
  }
  if (sourceDate.seconds) return new Date(sourceDate.seconds * 1000);
  return null;
}

// The time-filter tabs, left→right. Today is the default landing tab; the
// forward windows come first, then the two late buckets, then delivered history.
const FILTERS = ['Today', 'Tomorrow', '10 Days', 'Coming Up', 'Overdue', 'Past 10 Days', 'Completed'];

// Date anchors used to bucket orders into the time filters. Rebuilt per render so
// the rolling windows track the current day.
function buildFilterContext() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const plus10 = new Date(today); plus10.setDate(today.getDate() + 10);     // end of the rolling 10-day window
  const minus10 = new Date(today); minus10.setDate(today.getDate() - 10);   // overdue ↔ past-10-days split
  return { today, tomorrow, plus10, minus10 };
}

type FilterCtx = ReturnType<typeof buildFilterContext>;

// Does an order belong under the given time filter? Pure date/status logic,
// independent of the Dropoff/Pickup toggle (callers AND that in separately).
//  - Forward windows (Today / Tomorrow / 10 Days) match when EITHER scheduled day
//    — handoff (drop-off/pickup) or need-by (ready/deliver-by) — lands inside them.
//  - Past windows key off the DEADLINE (need-by, fallback handoff): an order isn't
//    late until its deliver-by day passes. Overdue = up to 10 days late;
//    Past 10 Days = more than 10 days late.
//  - Coming Up = the order's soonest day starts beyond the 10-day window.
//  - Completed = orders marked done (delivered) TODAY — both order types.
function matchesTimeFilter(order: any, filter: string, ctx: FilterCtx): boolean {
  const { today, tomorrow, plus10, minus10 } = ctx;

  if (filter === 'Completed') {
    if (order.status !== 'completed') return false;
    // Key off WHEN it was marked done (completedAt, fallback the status-change
    // updatedAt) — never needBy, which is the scheduled deadline, not completion.
    const raw = order.completedAt || order.updatedAt;
    if (!raw) return false;
    const d = typeof raw === 'string' ? new Date(raw) : new Date((raw as any).seconds * 1000);
    if (isNaN(d.getTime())) return false;
    d.setHours(0, 0, 0, 0);
    return d.getTime() === today.getTime();
  }

  // Every other filter is for OPEN orders only.
  if (order.status === 'cancelled') return false;

  // Rental dates: delivery day = startDate, due-back = expectedEndDate.
  const start = resolveOrderDate(order.startDate, today, tomorrow);
  const end = resolveOrderDate(order.expectedEndDate ?? order.startDate, today, tomorrow);
  if (!start && !end) return false;
  const anchor = start ?? end;     // soonest day — handoff first (future bucketing)
  const deadline = end ?? start;   // latest day — need-by first (late bucketing)
  const onDay = (t: Date) => start?.getTime() === t.getTime() || end?.getTime() === t.getTime();
  const inRange = (d: Date | null, a: Date, b: Date) => !!d && d.getTime() >= a.getTime() && d.getTime() <= b.getTime();

  switch (filter) {
    case 'Today':        return onDay(today);
    case 'Tomorrow':     return onDay(tomorrow);
    case '10 Days':      return inRange(start, today, plus10) || inRange(end, today, plus10);
    case 'Coming Up':    return !!anchor && anchor.getTime() > plus10.getTime();
    case 'Overdue':      return !!deadline && deadline.getTime() < today.getTime() && deadline.getTime() >= minus10.getTime();
    case 'Past 10 Days': return !!deadline && deadline.getTime() < minus10.getTime();
    default:             return false;
  }
}

// The three operations lanes, derived purely from an order's status + type:
//  - delivery:   bike still going OUT (ready → en route → at customer) — all rental types.
//  - rentalDue:  delivered plain rent — the bike has to come back (Check bike back in).
//  - paymentDue: delivered rent-to-buy — no return; instead installments run until paid off.
// A rent-to-buy leaves paymentDue only when its plan completes (status → completed).
// Returns null for statuses that belong to no lane (completed / cancelled).
type OpsCategory = 'delivery' | 'rentalDue' | 'paymentDue';
function categoryOf(order: any): OpsCategory | null {
  const s = order.status;
  if (s === OrderStatus.READY_FOR_DELIVERY || s === OrderStatus.EN_ROUTE_DELIVERY || s === OrderStatus.AT_DELIVERY) {
    return 'delivery';
  }
  if (s === OrderStatus.DELIVERED) {
    // A buy has no return leg — it completes at delivery (markRentalDelivered sets it
    // straight to COMPLETED), so it never belongs to the Rental Due / Payment Due lanes.
    // Guard defensively in case a legacy order is still sitting in DELIVERED.
    if (order.rentalType === 'buy') return null;
    return order.rentalType === 'rentToBuy' ? 'paymentDue' : 'rentalDue';
  }
  return null;
}

// ISO timestamp → "Mon, Jul 1" for the next-payment line on payment-due cards.
function fmtPaymentDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// Money summary for a rent-to-buy plan, from the live billingSchedule the mirror
// carries onto the provider order.
function rtbSummary(order: any) {
  const s = order.billingSchedule;
  if (!s) return null;
  const per = Number(s.perPeriodAmount) || 0;
  const total = Number(s.periodsTotal) || 0;
  const paidCount = Number(s.periodsCharged) || 0;
  const remainingCount = Math.max(0, total - paidCount);
  return {
    per,
    total,
    paidCount,
    remainingCount,
    paidToDate: Math.round(paidCount * per * 100) / 100,
    remaining: Math.round(remainingCount * per * 100) / 100,
    nextChargeAt: s.nextChargeAt as string | null,
    pastDue: s.status === 'past_due',
  };
}

export default function LogisticsScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const functions = firebase.app().functions('us-central1');

  // Shared hooks replace the per-screen config/provider/orders listener blocks.
  // Orders are capped to the 100 most-recent active+recent-completed (served by
  // the orders(providerId,status,createdAt) composite index).
  const config = useGlobalConfig();
  const { profile: providerProfile, loading: providerLoading } = useActiveProvider();
  const { orders, loading: ordersLoading, applyOptimistic, clearOptimistic } = useProviderOrders(providerProfile?.id, {
    statuses: ['ready_for_delivery', 'en_route_delivery', 'at_delivery', 'delivered', 'completed'],
    limitTo: 100,
  });
  const loading = providerLoading || (!!providerProfile?.id && ordersLoading);

  // Adjust-price modal + logic is shared with the Dispatch screen.

  // Operations has three lanes: bikes going OUT (delivery pipeline), delivered
  // plain rents awaiting return (rentalDue), and delivered rent-to-buy on an
  // installment plan (paymentDue). See categoryOf().
  const [opsTab, setOpsTab] = useState<OpsCategory>('delivery');
  const [timeFilter, setTimeFilter] = useState('Today');
  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Guards trailing setState after network awaits: switching store re-keys and unmounts
  // this screen (App.tsx key={activeStoreZip}) while a status round-trip is in flight.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [showQRScanner, setShowQRScanner] = useState(false);
  // Order being handed over — drives the condition-capture sheet.
  const [handoverOrder, setHandoverOrder] = useState<any | null>(null);
  // Order being checked back in — same sheet, return mode.
  const [returnOrder, setReturnOrder] = useState<any | null>(null);
  const [scannedOrder, setScannedOrder] = useState<any | null>(null);

  const [qrNotFound, setQrNotFound] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const filteredOrders = useMemo(() => {
    if (!orders.length) return [];

    const ctx = buildFilterContext();
    const result = orders.filter(order => {
      if (!matchesTimeFilter(order, timeFilter, ctx)) return false;
      // Completed is a daily done-summary — show everything regardless of the toggle.
      if (timeFilter === 'Completed') return true;
      return categoryOf(order) === opsTab;
    });

    // Late buckets list the most recently-missed order first; other tabs keep feed order.
    if (timeFilter === 'Overdue' || timeFilter === 'Past 10 Days') {
      result.sort((a, b) => {
        const da = resolveOrderDate(a.needByDay ?? a.pickupDay ?? a.needBy, ctx.today, ctx.tomorrow);
        const dbt = resolveOrderDate(b.needByDay ?? b.pickupDay ?? b.needBy, ctx.today, ctx.tomorrow);
        return (dbt?.getTime() ?? 0) - (da?.getTime() ?? 0);
      });
    }

    return result;
  }, [orders, opsTab, timeFilter]);

  // Counts that drive the filter-tab badges and the three lane toggles. Both react
  // to the current selection so the numbers never disagree with what tapping shows:
  //  - filterCounts[f]: orders matching filter `f` AND the active lane — the number
  //    on each tab reflects the load you'd see for the lane you're viewing.
  //    (Completed ignores the lane — it's an all-lanes daily done-summary.)
  //  - delivery/rentalDue/paymentDueCount: orders matching the CURRENTLY selected
  //    filter, split by lane — so the toggle shows e.g. tomorrow's load when on the
  //    Tomorrow tab, not just today's. activeOrders = all open (non-delivered) orders.
  const { filterCounts, deliveryCount, rentalDueCount, paymentDueCount, activeOrders } = useMemo(() => {
    const ctx = buildFilterContext();
    const fc: Record<string, number> = {};
    for (const f of FILTERS) fc[f] = 0;
    let delivery = 0, rentalDue = 0, paymentDue = 0, active = 0;
    for (const order of orders) {
      if (order.status === 'cancelled') continue;
      if (order.status !== 'delivered') active++;
      const cat = categoryOf(order);
      for (const f of FILTERS) {
        if (!matchesTimeFilter(order, f, ctx)) continue;
        if (cat === opsTab || f === 'Completed') fc[f]++;                 // tab badge: lane-scoped, except Completed (all lanes)
        if (f === timeFilter) {
          if (cat === 'delivery') delivery++;
          else if (cat === 'rentalDue') rentalDue++;
          else if (cat === 'paymentDue') paymentDue++;
        }
      }
    }
    return { filterCounts: fc, deliveryCount: delivery, rentalDueCount: rentalDue, paymentDueCount: paymentDue, activeOrders: active };
  }, [orders, opsTab, timeFilter]);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || !isSearchActive) return [];
    const q = searchQuery.toLowerCase().trim();
    const qDigits = q.replace(/\D/g, '');

    // Match by name / phone / order # across the whole fetched window regardless
    // of date — a customer who walks in with an overdue order must still be found.
    return orders.filter(order => {
      const name = (order.customerName ?? '').toLowerCase();
      const phone = (order.customerPhone ?? '').replace(/\D/g, '');
      const orderId = (order.id ?? '').toLowerCase();

      return name.includes(q) || (qDigits.length > 0 && phone.includes(qDigits)) || orderId.includes(q);
    });
  }, [orders, searchQuery, isSearchActive]);

  // Remote order-# fallback: when the query looks like an order id (full id or
  // its numeric part) and nothing in the fetched window matches, look the order
  // up directly so orders beyond the 100-cap are still reachable by number/QR.
  // Name/phone aren't resolvable this way (not exact-keyed), so they stay local.
  const [remoteSearchResults, setRemoteSearchResults] = useState<any[]>([]);
  const [remoteSearching, setRemoteSearching] = useState(false);

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    const qDigits = q.replace(/\D/g, '');
    let prefix: string | null = null;
    if (q.startsWith('order_')) prefix = q;
    else if (qDigits.length >= 6) prefix = `order_${qDigits}`;

    // Not an id-shaped query, search closed, or already covered locally → no fetch.
    if (!isSearchActive || !prefix || orders.some(o => (o.id ?? '').toLowerCase().startsWith(prefix!))) {
      setRemoteSearchResults([]);
      setRemoteSearching(false);
      return;
    }

    let cancelled = false;
    setRemoteSearching(true);
    const handle = setTimeout(async () => {
      try {
        const snap = await db.collection('providerOrders')
          .where('id', '>=', prefix)
          .where('id', '<=', prefix + '')
          .limit(10)
          .get();
        if (cancelled) return;
        const pid = providerProfile?.id;
        const found = snap.docs
          .map((d: any) => ({ id: d.id, ...d.data() }))
          .filter((o: any) => !pid || o.providerId === pid);
        setRemoteSearchResults(found);
      } catch {
        if (!cancelled) setRemoteSearchResults([]);
      } finally {
        if (!cancelled) setRemoteSearching(false);
      }
    }, 350); // debounce typing

    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery, isSearchActive, orders, providerProfile?.id]);

  // Local hits first, then any remote-only order, de-duped by id.
  const searchDisplay = useMemo(() => {
    const seen = new Set(searchResults.map(o => o.id));
    return [...searchResults, ...remoteSearchResults.filter(o => !seen.has(o.id))];
  }, [searchResults, remoteSearchResults]);

  // Orders where the customer has reached out via Chat Manager and the provider
  // hasn't opened the thread yet. Set by the onCustomerMessageSent function,
  // cleared when ChatScreen opens. Drives the header bell + per-card highlight.
  const unreadOrders = useMemo(
    () => orders.filter((o) => o.providerUnreadMessage === true),
    [orders],
  );
  const hasUnread = unreadOrders.length > 0;

  const handleOpenUnread = () => {
    if (!hasUnread) {
      Alert.alert('No New Messages', 'No customers have reached out yet. New chat messages will show up here.');
      return;
    }
    // unreadOrders preserves the feed's createdAt-desc order → jump to the most
    // recent customer who reached out. The card badges flag the rest.
    const target = unreadOrders[0];
    navigation.navigate('Chat', { orderId: target.id });
  };

  // Foodyzz owns the fleet, so this is the rental total, not a provider cut.
  const getPayout = (order: any) =>
    Number(order.chargedAmount ?? order.estimatedPrice ?? 0).toFixed(2);

  const getStatusLabel = (status: string, _isPickupOrder: boolean): string => {
    const map: Record<string, string> = {
      confirmed: 'Awaiting Documents',
      ready_for_delivery: 'Ready for Delivery',
      en_route_delivery: 'Out for Delivery',
      at_delivery: 'At Customer',
      delivered: 'Rental Running',
      completed: 'Returned',
      cancelled: 'Cancelled',
    };
    return map[status] ?? status.replace(/_/g, ' ');
  };
  const handleUpdateStatus = async (order: RentalOrder, newStatus: OrderStatus) => {
    // Re-entry guard: ignore a second tap while this order's transition is in flight
    // (the buttons also disable, but the network round-trip has real latency).
    if (processingOrderId === order.id) return;
    setProcessingOrderId(order.id);
    const updateData: Record<string, any> = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    // Stamp when the order was marked done so the Completed-Today tab can key off
    // it (mirrors DispatchScreen). Only set once; don't overwrite an earlier stamp.
    if ((newStatus === OrderStatus.DELIVERED || newStatus === OrderStatus.COMPLETED) && !(order as any).completedAt) {
      updateData.completedAt = new Date().toISOString();
    }
    // Advance the card immediately; the provider-mirror hop reconciles (or the catch
    // rolls it back on failure).
    applyOptimistic(order.id, updateData);
    try {
      await db.collection('orders').doc(order.id).update(updateData);
    } catch (error: any) {
      clearOptimistic(order.id); // roll back the optimistic advance
      Alert.alert('Status Update Failed', error.message || 'Could not sync status change.');
    } finally {
      if (mountedRef.current) setProcessingOrderId(null);
    }
  };

  // Rent-to-buy early payoff: charge the customer's saved card for every remaining
  // installment at once. The payoffRentToBuy function completes ownership, releases
  // any held deposit, and emails the customer the congratulations receipt — so all
  // this side does is confirm, call, and optimistically clear the card out of the
  // Payment Due lane.
  const handlePayoff = (order: any) => {
    if (processingOrderId === order.id) return;
    const s = rtbSummary(order);
    if (!s || s.remainingCount <= 0) return;

    Alert.alert(
      'Pay Remaining Balance',
      `Charge ${order.customerName || 'the customer'}'s saved card $${s.remaining.toFixed(2)} for the remaining ${s.remainingCount} payment${s.remainingCount === 1 ? '' : 's'}?\n\n` +
        'This pays off the rent-to-buy plan in full. The bike becomes theirs and they get a confirmation email.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Charge Card',
          onPress: async () => {
            setProcessingOrderId(order.id);
            // Clear the card out of Payment Due immediately; the mirror reconciles
            // (or the catch rolls it back if the charge fails).
            applyOptimistic(order.id, {
              status: OrderStatus.COMPLETED,
              rentToBuyOwned: true,
              completedAt: new Date().toISOString(),
              billingSchedule: {
                ...order.billingSchedule,
                status: 'completed',
                periodsCharged: order.billingSchedule?.periodsTotal ?? s.total,
                nextChargeAt: null,
              },
            });
            try {
              const payoffCall = functions.httpsCallable('payoffRentToBuy');
              await payoffCall({ orderId: order.id });
              Alert.alert(
                'Paid in Full 🎉',
                `${order.customerName || 'The customer'} now owns the bike. A confirmation email is on its way.`,
              );
            } catch (error: any) {
              clearOptimistic(order.id); // roll back — nothing was charged
              Alert.alert('Payment Failed', error?.message || 'Could not charge the saved card.');
            } finally {
              if (mountedRef.current) setProcessingOrderId(null);
            }
          },
        },
      ],
    );
  };

  const handleSendLocationUpdate = async (order: RentalOrder, status: string) => {
    // Re-entry guard mirrors handleUpdateStatus.
    if (processingOrderId === order.id) return;
    setProcessingOrderId(order.id);
    // Advance the card immediately so a slow/indoor GPS fix never stalls the workflow
    // (server may auto-arrive further; the mirror reconciles). The GPS lookup below is
    // bounded by an internal timeout and only supplies the best-effort map pin.
    applyOptimistic(order.id, { status });
    // Real device GPS so the customer sees the provider's actual position. Best-effort:
    // if the provider denies location or a fix fails, coords is null and the status
    // still advances (the server just omits the map pin for this update).
    const coords = await getCurrentProviderCoords();
    try {
      const updateLocationCall = functions.httpsCallable('updateProviderLocationAndStatus');
      await updateLocationCall({ orderId: order.id, lat: coords?.lat ?? null, lng: coords?.lng ?? null, providerCurrentStatus: status });
      if (!coords) warnLocationUnavailableOnce();
    } catch (error: any) {
      clearOptimistic(order.id); // roll back the optimistic advance
      Alert.alert('Location Error', error.message);
    } finally {
      if (mountedRef.current) setProcessingOrderId(null);
    }
  };

  const handleCancelOrder = (orderId: string) => {
    Alert.alert(
      'Cancel Order',
      'Are you sure? Cancellations are tracked and may affect your performance rating.',
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: async () => {
            try {
              const cancelCall = functions.httpsCallable('cancelOrder');
              await cancelCall({ orderId, reason: 'Provider Manual Cancellation' });
              Alert.alert('Success', 'Order cancelled and customer notified.');
            } catch (error: any) {
              Alert.alert('Cancellation Failed', error.message);
            }
          },
        },
      ]
    );
  };

  const handleQRScan = async () => {
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) return;
    }
    setHasScanned(false);
    setShowQRScanner(true);
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (hasScanned) return;
    setHasScanned(true);
    setShowQRScanner(false);
    const localOrder = orders.find(o => o.id === data);
    if (localOrder) {
      setScannedOrder(localOrder);
      return;
    }
    try {
      const docSnap = await db.collection('providerOrders').doc(data).get();
      if (docSnap.exists) {
        setScannedOrder({ id: docSnap.id, ...docSnap.data() });
      } else {
        setQrNotFound(true);
      }
    } catch {
      setQrNotFound(true);
    }
  };

  const renderOrderCard = (order: any) => {
    // Every rental is delivered to the customer — there is no pickup variant.
    const isPickupOrder = false;
    // A status transition for THIS order is in flight — disable its action buttons so
    // the notification/network lag can't turn a double-tap into a double status write.
    const busy = processingOrderId === order.id;
    // A physical bike must be assigned before a delivery can leave — gates Start Delivery.
    const hasBike = order.bikeId != null && order.bikeId !== '';
    // Customer reached out via Chat Manager and the provider hasn't opened it yet.
    const hasUnread = order.providerUnreadMessage === true;
    const sched = getScheduleLines(order);
    // On Today/Tomorrow, yellow-highlight the exact line whose day matched the
    // filter (drop-off/pickup vs ready/deliver-by) so the provider sees at a
    // glance which date this card is here for. Both can match a same-day order.
    const dayHL = (() => {
      if (timeFilter !== 'Today' && timeFilter !== 'Tomorrow') return { handoff: false, needBy: false };
      const t = new Date(); t.setHours(0, 0, 0, 0);
      if (timeFilter === 'Tomorrow') t.setDate(t.getDate() + 1);
      // Rental dates: delivery day = startDate, due-back = expectedEndDate.
      const start = resolveOrderDate(order.startDate, t, t);
      const end = resolveOrderDate(order.expectedEndDate ?? order.startDate, t, t);
      return { handoff: start?.getTime() === t.getTime(), needBy: end?.getTime() === t.getTime() };
    })();

    // Delivered rent-to-buy → the card runs on installments, not a return. Swap the
    // due-back schedule for the payment plan and the "Check bike back in" button for
    // an early-payoff action.
    const isPaymentDue = categoryOf(order) === 'paymentDue';
    const rtb = isPaymentDue ? rtbSummary(order) : null;

    return (
      <View
        key={order.id}
        style={{
          backgroundColor: hasUnread ? '#fce7f3' : (isPickupOrder ? '#f0fdf4' : '#ffffff'),
          borderColor: hasUnread ? '#ec4899' : '#000000',
        }}
        className="border-2 rounded-[32px] p-5 mb-4 shadow-brutalist"
      >
        {/* Customer-reached-out banner — clears once the chat is opened */}
        {hasUnread && (
          <TouchableOpacity
            onPress={() => navigation.navigate('Chat', { orderId: order.id })}
            className="flex-row items-center gap-2 bg-brand-green/15 border border-brand-green/40 rounded-2xl px-3 py-2 mb-3"
          >
            <Pulse>
              <View className="w-2.5 h-2.5 rounded-full bg-brand-green" />
            </Pulse>
            <MessageSquare size={12} color="#db2777" />
            <Text className="text-brand-green-dark font-black text-[9px] uppercase tracking-widest flex-1">
              Customer reached out · Tap to reply
            </Text>
          </TouchableOpacity>
        )}
        {/* Header */}
        <View className="flex-row justify-between items-start mb-4 pb-3 border-b border-slate-100">
          <View className="flex-1 mr-3">
            <View className="flex-row items-center flex-wrap gap-1.5 mb-1.5">
              <View className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                <Text className="text-slate-500 font-mono text-[8px] font-black">{order.id.replace('order_', '#').toUpperCase()}</Text>
              </View>
              <View
                style={{ backgroundColor: '#eef2ff', borderColor: '#c7d2fe' }}
                className="flex-row items-center gap-1 px-1.5 py-0.5 rounded border"
              >
                <Bike size={9} color="#4338ca" />
                <Text style={{ color: '#4338ca' }} className="font-black text-[7px] uppercase">
                  {order.rentalType === 'rentToBuy' ? 'Rent to Buy' : order.rentalType === 'buy' ? 'Buy' : 'Rent'}
                  {order.bikeModel ? ` · M${order.bikeModel}` : ''}
                </Text>
              </View>
            </View>
            <Text className="text-black font-black text-xs uppercase tracking-tight">{order.customerName}</Text>
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}>
              <View className="flex-row items-center gap-1 mt-0.5">
                <Phone size={10} color="#507425" />
                <Text className="text-brand-green-dark text-[10px] font-bold">{order.customerPhone}</Text>
              </View>
            </TouchableOpacity>

          </View>
          <View className="items-end">
            <Text className="text-brand-green-dark font-mono font-black text-sm tracking-tight">${getPayout(order)}</Text>
            <Text className="text-[7px] font-black uppercase tracking-widest text-slate-400">
              {order.status === 'delivered' || order.status === 'completed' ? 'Charged' : 'To capture'}
            </Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Chat', { orderId: order.id })}
              style={hasUnread ? { backgroundColor: '#fbcfe8', borderColor: '#ec4899' } : undefined}
              className="p-2 bg-slate-50 border border-slate-200 rounded-xl mt-2"
            >
              <MessageSquare size={14} color={hasUnread ? '#db2777' : '#86B54F'} />
              {hasUnread && (
                <Pulse style={{ position: 'absolute', top: -4, right: -4 }}>
                  <View className="w-3 h-3 rounded-full bg-brand-green border-2 border-white" />
                </Pulse>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Service Details */}
        <View className="space-y-3 mb-4">
          {isPickupOrder && (
            <View className="flex-row items-start gap-2.5">
              <MapPin size={14} color="#507425" />
              <View>
                <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">Delivery Address</Text>
                <Text className="text-slate-700 text-[10px] font-bold leading-snug">{order.customerAddress}</Text>
              </View>
            </View>
          )}
          <View className="flex-row items-start gap-2.5">
            {isPaymentDue ? <CreditCard size={14} color="#507425" /> : <Clock size={14} color="#507425" />}
            <View className="flex-1">
              <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">
                {isPaymentDue ? 'Rent-to-Buy Plan' : 'Rental Detail'}
              </Text>
              <Text className="text-black text-[10px] font-black uppercase">
                {order.bikeModel ? `MODEL ${order.bikeModel}` : 'BIKE'}
                {order.bikeNo ? ` · #${order.bikeNo}` : ''}
                {order.durationValue ? ` • ${order.durationValue} ${String(order.durationUnit || '').toUpperCase()}` : ''}
              </Text>

              {isPaymentDue && rtb ? (
                /* Installment progress: next payment (replaces due-back), payments
                   made, total paid to date, and remaining balance. */
                <View className="mt-1.5">
                  <View className={`flex-row items-baseline gap-1.5 ${rtb.pastDue ? 'bg-rose-100 rounded-md px-1.5 py-0.5 self-start' : ''}`}>
                    <View className="flex-row items-center gap-1">
                      <CalendarClock size={9} color={rtb.pastDue ? '#be123c' : '#64748b'} />
                      <Text className={`text-[8px] font-black uppercase tracking-wide ${rtb.pastDue ? 'text-rose-700' : 'text-slate-500'}`}>Next Payment</Text>
                    </View>
                    <Text className={`text-[10px] font-black uppercase ${rtb.pastDue ? 'text-rose-700' : 'text-black'}`}>
                      {rtb.pastDue ? 'Past due · manual' : fmtPaymentDate(rtb.nextChargeAt)}
                    </Text>
                  </View>
                  <View className="flex-row items-baseline gap-1.5 mt-1">
                    <Text className="text-[8px] font-black uppercase tracking-wide text-slate-500">Payments Made</Text>
                    <Text className="text-[10px] font-black uppercase text-black">{rtb.paidCount} / {rtb.total}</Text>
                  </View>
                  <View className="flex-row items-baseline gap-1.5 mt-0.5">
                    <Text className="text-[8px] font-black uppercase tracking-wide text-slate-500">Paid to Date</Text>
                    <Text className="text-[10px] font-black uppercase text-black">${rtb.paidToDate.toFixed(2)}</Text>
                  </View>
                  <View className="flex-row items-baseline gap-1.5 mt-0.5">
                    <Text className="text-[8px] font-black uppercase tracking-wide text-slate-500">Remaining</Text>
                    <Text className="text-[10px] font-black uppercase text-brand-green-dark">${rtb.remaining.toFixed(2)}</Text>
                  </View>
                </View>
              ) : (
                /* Two-part schedule on its own stacked lines (handoff + need-by). */
                <View className="mt-1.5">
                  <View className={`flex-row items-baseline gap-1.5 ${dayHL.handoff ? 'bg-yellow-200 rounded-md px-1.5 py-0.5 self-start' : ''}`}>
                    <Text className={`text-[8px] font-black uppercase tracking-wide ${dayHL.handoff ? 'text-amber-900' : 'text-slate-500'}`}>{sched.handoff.label}</Text>
                    <Text className={`text-[10px] font-black uppercase ${dayHL.handoff ? 'text-amber-900' : 'text-black'}`}>{sched.handoff.value}</Text>
                  </View>
                  <View className={`flex-row items-baseline gap-1.5 mt-0.5 ${dayHL.needBy ? 'bg-yellow-200 rounded-md px-1.5 py-0.5 self-start' : ''}`}>
                    <Text className={`text-[8px] font-black uppercase tracking-wide ${dayHL.needBy ? 'text-amber-900' : 'text-slate-500'}`}>{sched.needBy.label}</Text>
                    <Text className={`text-[10px] font-black uppercase ${dayHL.needBy ? 'text-amber-900' : 'text-black'}`}>{sched.needBy.value}</Text>
                  </View>
                </View>
              )}
            </View>
          </View>
          {/* Provider-private notes — only the provider sees these. */}
          <ProviderNotes orderId={order.id} />
          {/* Bike-number assignment / display. Required before Start Delivery; the
              chosen number then rides on the card for the life of the transaction. */}
          <BikeAssignment order={order} onAssigned={applyOptimistic} />
        </View>

        {/* Action Buttons */}
        <View className="flex-row gap-2">
          {/* ── Delivery pipeline ─────────────────────────────────────────
              Ready → Start Delivery → Mark At Location → Delivered.
              Each transition notifies the customer via onOrderDeliveryStatusNotify. */}
          {order.status === OrderStatus.READY_FOR_DELIVERY && (
            <TouchableOpacity
              onPress={() => hasBike && handleSendLocationUpdate(order, OrderStatus.EN_ROUTE_DELIVERY)}
              disabled={busy || !hasBike}
              activeOpacity={busy || !hasBike ? 1 : 0.8}
              style={{ opacity: busy || !hasBike ? 0.6 : 1 }}
              className="flex-1 bg-[#86B54F] py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
            >
              <Truck size={14} color="black" />
              <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                {hasBike ? 'Start Delivery' : 'Select a bike first'}
              </Text>
            </TouchableOpacity>
          )}

          {order.status === OrderStatus.EN_ROUTE_DELIVERY && (
            <TouchableOpacity
              onPress={() => handleSendLocationUpdate(order, OrderStatus.AT_DELIVERY)}
              disabled={busy}
              activeOpacity={busy ? 1 : 0.8}
              style={{ opacity: busy ? 0.6 : 1 }}
              className="flex-1 bg-yellow-400 py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
            >
              <MapPin size={14} color="black" />
              <Text className="text-black font-black uppercase text-[10px] tracking-widest">Mark At Location</Text>
            </TouchableOpacity>
          )}

          {order.status === OrderStatus.AT_DELIVERY && (
            <TouchableOpacity
              onPress={() => setHandoverOrder(order)}
              disabled={busy}
              activeOpacity={busy ? 1 : 0.8}
              style={{ opacity: busy ? 0.6 : 1 }}
              className="flex-1 bg-indigo-500 py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
            >
              <Package size={14} color="white" />
              <Text className="text-white font-black uppercase text-[10px] tracking-widest">Inspect &amp; Deliver</Text>
            </TouchableOpacity>
          )}

          {order.status === OrderStatus.DELIVERED && !isPaymentDue && (
            <TouchableOpacity
              onPress={() => setReturnOrder(order)}
              disabled={busy}
              activeOpacity={busy ? 1 : 0.8}
              style={{ opacity: busy ? 0.6 : 1 }}
              className="flex-1 bg-[#86B54F] py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
            >
              <RefreshCcw size={14} color="black" />
              <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                Check bike back in
              </Text>
            </TouchableOpacity>
          )}

          {/* Delivered rent-to-buy: no return — charge the remaining installments up
              front to complete ownership. Disabled once nothing is left to charge. */}
          {order.status === OrderStatus.DELIVERED && isPaymentDue && (
            <TouchableOpacity
              onPress={() => handlePayoff(order)}
              disabled={busy || !rtb || rtb.remainingCount <= 0}
              activeOpacity={busy ? 1 : 0.8}
              style={{ opacity: busy || !rtb || rtb.remainingCount <= 0 ? 0.6 : 1 }}
              className="flex-1 bg-[#86B54F] py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
            >
              <CreditCard size={14} color="black" />
              <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                {rtb ? `Pay Remaining $${rtb.remaining.toFixed(2)}` : 'Pay Remaining Balance'}
              </Text>
            </TouchableOpacity>
          )}

          {order.status === OrderStatus.COMPLETED && (
            <View className="flex-1 bg-slate-50 py-3.5 rounded-2xl items-center flex-row justify-center gap-2 border border-slate-200">
              <CheckCircle size={14} color="#64748b" />
              <Text className="text-slate-500 font-black uppercase text-[10px] tracking-widest">
                {/* Only a deposit still awaiting release reads "releasing"; a buy (no
                    deposit) or an already-refunded rent reads plain "Completed". */}
                {order.depositStatus === 'secured' || order.depositStatus === 'charged' ? 'Deposit releasing' : 'Completed'}
              </Text>
            </View>
          )}
        </View>

        {/* Status pill + cancel */}
        {![OrderStatus.EN_ROUTE_DELIVERY, OrderStatus.AT_DELIVERY, OrderStatus.DELIVERED].includes(order.status as OrderStatus) &&
          !(order.status === OrderStatus.COMPLETED && !isPickupOrder) && (
          <View className="flex-row gap-2 mt-2">
            <View
              style={{ backgroundColor: false ? '#fbbf24' : '#000000' }}
              className="flex-1 py-3 rounded-2xl items-center border-2 border-black flex-row justify-center gap-2"
            >
              <View
                style={{ backgroundColor: false ? '#000000' : '#86B54F' }}
                className="w-2 h-2 rounded-full"
              />
              <Text
                numberOfLines={1}
                style={{
                  includeFontPadding: false,
                  lineHeight: 16,
                  fontSize: 11,
                  fontWeight: '900',
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: false ? '#000000' : '#ffffff',
                }}
              >
                {getStatusLabel(order.status, isPickupOrder)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => handleCancelOrder(order.id)}
              className="px-4 bg-rose-50 border border-rose-100 rounded-2xl justify-center items-center"
            >
              <Text className="text-rose-600 font-black uppercase text-[8px] tracking-widest">Cancel</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-white justify-center items-center">
        <ActivityIndicator color="#507425" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Header */}
      <View className="bg-slate-900 px-4 pb-6 border-b-4 border-black mb-6 shadow-sm" style={{ paddingTop: top + 16 }}>
        <View className="flex-row justify-between items-end mb-4">
          <View>
            <Text className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-widest mb-1">
              Daily Operations
            </Text>
            <Text className="text-2xl font-black text-white uppercase tracking-tighter">
              Operational<Text className="text-brand-green"> Insight</Text>
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => navigation.navigate('Account')}
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl"
            >
              <User size={18} color="#64748b" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleOpenUnread}
              className="p-2 bg-slate-800 border border-slate-700 rounded-xl"
            >
              <Bell size={18} color={hasUnread ? '#86B54F' : '#64748b'} />
              {hasUnread && (
                <Pulse style={{ position: 'absolute', top: -4, right: -4 }}>
                  <View className="bg-brand-green rounded-full min-w-[16px] h-4 px-1 items-center justify-center border-2 border-slate-900">
                    <Text className="text-black text-[8px] font-black">{unreadOrders.length}</Text>
                  </View>
                </Pulse>
              )}
            </TouchableOpacity>
          </View>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1 bg-slate-800 p-4 rounded-2xl border border-slate-700">
            <Text className="text-white text-lg font-black font-mono">{activeOrders}</Text>
            <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest">Active Orders</Text>
          </View>
          <View className="flex-1 bg-slate-800 p-4 rounded-2xl border border-slate-700">
            <Text className="text-emerald-400 text-lg font-black font-mono">100%</Text>
            <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-widest">On-Time SVC</Text>
          </View>
        </View>
      </View>

      {/* Controls */}
      <View className="px-4 mb-4">
        {/* Search bar */}
        {isSearchActive ? (
          <View className="flex-row items-center gap-2 mb-3">
            <View className="flex-1 flex-row items-center bg-slate-100 rounded-2xl border border-slate-200 px-3 gap-2">
              <Search size={14} color="#86B54F" />
              <TextInput
                autoFocus
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Name, phone, or order #..."
                placeholderTextColor="#94a3b8"
                style={{ flex: 1, paddingVertical: 12, fontSize: 12, color: '#000' }}
              />
              <TouchableOpacity onPress={() => { setIsSearchActive(false); setSearchQuery(''); }}>
                <X size={16} color="#475569" />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={handleQRScan}
              className="bg-slate-100 border border-slate-200 rounded-2xl p-3 items-center justify-center"
            >
              <QrCode size={20} color="#86B54F" />
            </TouchableOpacity>
          </View>
        ) : (
          <View className="flex-row items-center gap-2 mb-3">
            <TouchableOpacity
              onPress={() => setIsSearchActive(true)}
              className="flex-1 flex-row items-center gap-2 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3"
            >
              <Search size={14} color="#94a3b8" />
              <Text className="text-slate-400 text-[10px] font-bold uppercase tracking-wider flex-1">
                Search by name, phone, or order #
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleQRScan}
              className="bg-slate-50 border border-slate-200 rounded-2xl p-3 items-center justify-center"
            >
              <QrCode size={20} color="#94a3b8" />
            </TouchableOpacity>
          </View>
        )}

        {!isSearchActive && (
          <>
            {/* Three lanes: Delivery (bikes going out, all types) · Rental Due
                (delivered rents to bring back) · Payment Due (delivered rent-to-buy
                on an installment plan). Each badge counts the SELECTED time filter's
                load for that lane, with a green ring when there's work. */}
            <View className="flex-row bg-slate-100 p-1 rounded-2xl border border-slate-200 mb-3">
              {([
                { key: 'delivery', label: 'Delivery', count: deliveryCount, Icon: Truck },
                { key: 'rentalDue', label: 'Rental Due', count: rentalDueCount, Icon: RefreshCcw },
                { key: 'paymentDue', label: 'Payment Due', count: paymentDueCount, Icon: CreditCard },
              ] as { key: OpsCategory; label: string; count: number; Icon: any }[]).map(({ key, label, count, Icon }) => {
                const active = opsTab === key;
                const highlight = count > 0 || active;
                return (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setOpsTab(key)}
                    style={count > 0 ? { borderColor: '#86B54F', borderWidth: 1.5 } : undefined}
                    className={`flex-1 py-3 px-1 rounded-xl items-center flex-row justify-center gap-1 ${active ? 'bg-white border border-slate-200' : ''}`}
                  >
                    <Icon size={12} color={highlight ? '#86B54F' : '#475569'} />
                    <Text className={`text-[9px] font-black uppercase ${highlight ? 'text-brand-green' : 'text-slate-500'}`}>{label}</Text>
                    <View className={`rounded-full min-w-[16px] px-1 items-center justify-center ${count > 0 ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                      <Text className={`text-[9px] font-black ${count > 0 ? 'text-white' : 'text-slate-600'}`}>{count}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View className="flex-row gap-2">
                {FILTERS.map(f => (
                  <TouchableOpacity
                    key={f}
                    onPress={() => setTimeFilter(f)}
                    className={`px-4 py-2 rounded-xl border ${timeFilter === f ? 'bg-brand-green/10 border-brand-green/30' : 'bg-white border-slate-200'}`}
                  >
                    <Text className={`text-[9px] font-black uppercase tracking-wider ${timeFilter === f ? 'text-brand-green-dark' : 'text-slate-400'}`}>
                      {f}
                      {filterCounts[f] > 0 ? <Text className="text-emerald-500"> ({filterCounts[f]})</Text> : null}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
          </>
        )}
      </View>

      {/* List (virtualized) */}
      <FlatList
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 96 }}
        data={isSearchActive ? searchDisplay : filteredOrders}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={11}
        renderItem={({ item }) => renderOrderCard(item)}
        ListHeaderComponent={(
          <Text className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4 px-1">
            {isSearchActive
              ? `Search Results (${searchDisplay.length})${remoteSearching ? ' · searching…' : ''}`
              : `${timeFilter === 'Completed' ? 'Completed Today' : `${timeFilter} ${opsTab === 'delivery' ? 'Deliveries' : opsTab === 'rentalDue' ? 'Rentals Due' : 'Payments Due'}`} (${filteredOrders.length})`}
          </Text>
        )}
        ListEmptyComponent={isSearchActive && searchQuery.trim() ? (
          <View className="p-10 items-center opacity-40">
            {remoteSearching ? (
              <>
                <ActivityIndicator color="#475569" />
                <Text className="text-slate-500 font-bold text-xs uppercase mt-4 text-center">Searching all orders…</Text>
              </>
            ) : (
              <>
                <Search size={48} color="#475569" />
                <Text className="text-slate-500 font-bold text-xs uppercase mt-4 text-center">No matching orders found.</Text>
              </>
            )}
          </View>
        ) : null}
      />

      {/* QR Scanner Modal */}
      <Modal visible={showQRScanner} animationType="slide" onRequestClose={() => setShowQRScanner(false)}>
        <View style={{ flex: 1, backgroundColor: 'black' }}>
          {permission?.granted ? (
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              onBarcodeScanned={hasScanned ? undefined : handleBarcodeScan}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
              <Text style={{ color: 'white', fontWeight: '900', fontSize: 14, textTransform: 'uppercase', textAlign: 'center' }}>
                Camera Access Required
              </Text>
              <Text style={{ color: '#94a3b8', fontSize: 12, marginTop: 8, textAlign: 'center' }}>
                Grant camera permission to scan QR codes.
              </Text>
              <TouchableOpacity
                onPress={requestPermission}
                style={{ marginTop: 24, backgroundColor: '#86B54F', paddingVertical: 12, paddingHorizontal: 24, borderRadius: 16 }}
              >
                <Text style={{ color: 'black', fontWeight: '900', textTransform: 'uppercase', fontSize: 11 }}>Grant Permission</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Scan frame overlay */}
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
            <View style={{ width: 220, height: 220, borderWidth: 3, borderColor: '#86B54F', borderRadius: 16 }} />
            <Text style={{ color: 'white', fontWeight: '900', fontSize: 10, textTransform: 'uppercase', letterSpacing: 2, marginTop: 20 }}>
              Align QR Code in Frame
            </Text>
          </View>

          {/* Close button */}
          <TouchableOpacity
            onPress={() => setShowQRScanner(false)}
            style={{ position: 'absolute', top: 56, right: 20, backgroundColor: 'rgba(0,0,0,0.7)', padding: 10, borderRadius: 24 }}
          >
            <X size={22} color="white" />
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Scanned Result Modal */}
      <Modal
        visible={!!scannedOrder || qrNotFound}
        animationType="slide"
        transparent
        onRequestClose={() => { setScannedOrder(null); setQrNotFound(false); }}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: 'white', borderTopLeftRadius: 44, borderTopRightRadius: 44, borderTopWidth: 4, borderColor: 'black', padding: 24, maxHeight: '80%' }}>
            {qrNotFound ? (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: '#fef2f2', borderWidth: 2, borderColor: '#fecaca', justifyContent: 'center', alignItems: 'center', marginBottom: 16 }}>
                  <Search size={32} color="#ef4444" />
                </View>
                <Text style={{ fontWeight: '900', fontSize: 18, textTransform: 'uppercase', color: '#111827' }}>Not Found</Text>
                <Text style={{ color: '#94a3b8', fontSize: 11, marginTop: 8, textAlign: 'center', lineHeight: 16 }}>
                  This QR code doesn't match any order in the system.
                </Text>
                <TouchableOpacity
                  onPress={() => setQrNotFound(false)}
                  style={{ marginTop: 24, backgroundColor: 'black', paddingVertical: 14, borderRadius: 20, width: '100%', alignItems: 'center' }}
                >
                  <Text style={{ color: 'white', fontWeight: '900', textTransform: 'uppercase', fontSize: 11, letterSpacing: 1 }}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <View>
                    <Text style={{ fontSize: 9, fontWeight: '900', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 2 }}>Scanned Order</Text>
                    <Text style={{ fontSize: 20, fontWeight: '900', textTransform: 'uppercase', color: '#111827' }}>
                      {scannedOrder?.customerName ?? 'Customer'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => setScannedOrder(null)}
                    style={{ backgroundColor: '#f1f5f9', borderRadius: 20, padding: 8 }}
                  >
                    <X size={18} color="#111827" />
                  </TouchableOpacity>
                </View>
                {scannedOrder && renderOrderCard(scannedOrder)}
                <View style={{ height: 24 }} />
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* Adjust Price Modal (shared with the Dispatch screen) */}
      <HandoverSheet order={handoverOrder} onClose={() => setHandoverOrder(null)} />
      <HandoverSheet order={returnOrder} mode="return" onClose={() => setReturnOrder(null)} />
    </View>
  );
}
