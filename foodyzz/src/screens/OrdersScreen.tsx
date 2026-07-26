import React, { useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, ActivityIndicator, Alert, TextInput } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Calendar, Clock, X, CheckCircle, AlertTriangle, ChevronRight, MapPin, Star, MessageCircle } from 'lucide-react-native';
import { COLORS, LAYOUT } from '../theme'; // Adjusted import path
import { db, getFunctionsInstance } from '../services/firebase';
import authNative from '@react-native-firebase/auth';
import { collection, query, where, orderBy, limit, onSnapshot } from '@react-native-firebase/firestore';
import { useStripe } from '@stripe/stripe-react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import MapView from 'react-native-maps'; // Assuming react-native-maps is installed
import { Marker } from 'react-native-maps';
import { RentalOrder, OrderStatus } from '../types';
import { useUserProfile } from '../context/UserProfileContext';
import { hasDocumentOnFile } from '../services/customerDocuments';

// Status definitions aligned with POC. Always five steps — step 2 just renames
// itself to "ID Pending" (and turns orange) when the customer hasn't uploaded
// their documents yet, because that's the thing actually blocking the order.
const OrderSteps = [
    { key: 'requested', label: 'Requested' },
    { key: 'verifying', label: 'Verifying' },
    { key: 'confirmed', label: 'Confirmed' },
    { key: 'delivered', label: 'Delivered' },
    { key: 'completed', label: 'Done' },
];

// Step index of the verify stage — the only step the ID-pending rename applies to.
const VERIFY_STEP = 1;
const ID_PENDING_ORANGE = '#f97316';

// Documents are "on file" once BOTH the licence (front + back) and the proof of
// address have been uploaded. Verification is a separate, later stamp.
//
// A rejected pair counts as NOT on file even though the images are still stored:
// FoodyzzHQ has refused them and is waiting for replacements, so the order is once
// again blocked on the customer and the ID-Pending prompt has to come back.
const hasIdOnFile = (profile: any): boolean =>
    hasDocumentOnFile(profile, 'driverLicense') &&
    hasDocumentOnFile(profile, 'addressProof') &&
    !profile?.driverLicense?.rejectedReason &&
    !profile?.addressProof?.rejectedReason;

// The customer can pull out any time up until FoodyzzHQ marks the order ready for
// delivery — from that point the bike is being dispatched and cancelling is a call
// to the store, not a button.
const CANCELLABLE_STATUSES: string[] = [OrderStatus.REQUESTED, OrderStatus.CONFIRMED];

// Step for an order. 'confirmed' means accepted by FoodyzzHQ, but the customer only
// sees CONFIRMED once their ID is verified (docsVerifiedAt) — until then it sits on
// VERIFYING. Delivery states all read as CONFIRMED; delivered = the bike is with them.
const orderStepIndex = (order: RentalOrder): number => {
    switch (order.status) {
        case 'requested': return 0;
        case 'confirmed': return order.docsVerifiedAt ? 2 : 1;
        case 'ready_for_delivery':
        case 'en_route_delivery':
        case 'at_delivery': return 2;
        case 'delivered': return 3;
        case 'completed': return 4;
        default: return 0;
    }
};

const LIVE_TRACKING_STATUSES = ['en_route_pickup', 'at_pickup', 'rental_active', 'en_route_delivery', 'at_delivery'];

// "2026-06-30T00:08:00.836Z" → "Jun 30, 2026 · 8:08 PM" (local). Falls back to
// the raw value for any legacy/non-ISO string that won't parse.
const formatNeedBy = (val?: string | null | undefined): string => {
    if (!val) return '—';
    const d = new Date(val);
    if (isNaN(d.getTime())) return val;
    const datePart = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `${datePart} · ${timePart}`;
};

// History badge label. A drop-off order is completed by the customer collecting it
// themselves — there's no delivery leg — so show "Self-Pickup" rather than the raw
// 'delivered' status. Pickup & delivery orders keep "Delivered"; other statuses
// (e.g. 'cancelled') fall through unchanged.
const historyStatusLabel = (order: RentalOrder): string => {
    if (order.status === 'delivered' && (order as any).logisticsType === 'dropoff') return 'Self-Pickup';
    return order.status;
};





export default function OrdersScreen() {
    const navigation = useNavigation<any>();
    const route = useRoute<any>();
    // Shared users/{phone} listener — read here to know whether the customer's ID
    // documents are on file, which renames the "Verifying" step to "ID Pending".
    const { profile } = useUserProfile();
    const idOnFile = hasIdOnFile(profile);
    const [activeOrders, setActiveOrders] = useState<RentalOrder[]>([]);
    const [pastOrders, setPastOrders] = useState<RentalOrder[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<RentalOrder | null>(null); // Added RentalOrder type
    const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
    // Order whose cancellation is in flight — locks its button so a second tap can't
    // fire the callable twice while Stripe releases the hold.
    const [cancellingId, setCancellingId] = useState<string | null>(null);
    // Id of the order whose price adjustment is being approved/rejected. Locks the
    // Approve/Reject buttons so a second tap can't double-fire the (slow) Stripe
    // re-auth or send two status writes before the order leaves this state.
    const [processingAdjustmentId, setProcessingAdjustmentId] = useState<string | null>(null);
    // Post-delivery rating + tip UI state (for the selected order's detail modal).
    const [ratingStars, setRatingStars] = useState(0);
    const [ratingFeedback, setRatingFeedback] = useState('');
    const [submittingRating, setSubmittingRating] = useState(false);
    const [tipChoice, setTipChoice] = useState<number | null>(null);
    const [tipCustom, setTipCustom] = useState('');
    const [submittingTip, setSubmittingTip] = useState(false);
    // Order whose rent-to-buy early payoff is in flight — locks its Pay-off button.
    const [payingOffId, setPayingOffId] = useState<string | null>(null);
    const [user, setUser] = useState(authNative().currentUser);
    const { confirmPayment, initPaymentSheet, presentPaymentSheet } = useStripe();

    useEffect(() => {
        return authNative().onAuthStateChanged((u) => setUser(u));
    }, []);

    // Keep the open detail modal in sync with the live order (so a rating/tip just
    // submitted — or one the backend recorded via webhook — reflects without reopening).
    useEffect(() => {
        if (!selectedOrder) return;
        const fresh = [...activeOrders, ...pastOrders].find(o => o.id === selectedOrder.id);
        if (fresh && (fresh as any).updatedAt !== (selectedOrder as any).updatedAt) setSelectedOrder(fresh);
    }, [activeOrders, pastOrders]); // eslint-disable-line react-hooks/exhaustive-deps

    // Deep link from the "Order complete!" push: open that order's detail modal once
    // the orders have loaded, then clear the param so it doesn't reopen.
    useEffect(() => {
        const focusId = route.params?.focusOrderId;
        if (!focusId) return;
        const match = [...activeOrders, ...pastOrders].find(o => o.id === focusId);
        if (match) {
            setSelectedOrder(match);
            navigation.setParams({ focusOrderId: undefined });
        }
    }, [route.params?.focusOrderId, activeOrders, pastOrders]); // eslint-disable-line react-hooks/exhaustive-deps

    useLayoutEffect(() => {
        navigation.setOptions({
            headerShown: true,
            headerTitle: () => (
                <View>
                    <Text className="text-xl font-black text-black uppercase tracking-tighter leading-none">
                        My.<Text className="text-indigo-600">Rental</Text>
                    </Text>
                </View>
            ),
            headerTitleAlign: 'left',
            headerStyle: { elevation: 0, shadowOpacity: 0, borderBottomWidth: 0, backgroundColor: 'white' },
        });
    }, [navigation]);

    useEffect(() => {
        if (!user?.phoneNumber) return;

        // Cap to the 50 most-recent orders so a long-time customer doesn't stream
        // their entire history on every visit. Active orders are always recent, so
        // they remain visible; older delivered/cancelled orders beyond 50 are rare
        // for a single customer and intentionally not loaded here.
        const q = query(
            collection(db, 'orders'),
            where('customerPhone', '==', user.phoneNumber),
            orderBy('createdAt', 'desc'),
            limit(50)
        );

        const unsubscribe = onSnapshot(q, (snapshot) => {
            if (!snapshot) return;
            const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as RentalOrder));

            // Separate active vs history
            setActiveOrders(all.filter(o => !['delivered', 'cancelled'].includes(o.status)));
            setPastOrders(all.filter(o => ['delivered', 'cancelled'].includes(o.status)));
            setLoading(false);
        }, (error) => {
            console.error("Firestore Listen Error:", error);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user]);

    // Goes through the cancelOrder callable rather than writing status directly: it
    // releases the card authorization, frees any bike reserved for the order and
    // notifies the store. A raw status write left the hold sitting on the customer's
    // card until Stripe expired it ~7 days later.
    const handleCancelOrder = async (orderId: string) => {
        setCancellingId(orderId);
        try {
            await getFunctionsInstance().httpsCallable('cancelOrder')({
                orderId,
                reason: 'Cancelled by customer',
            });
            setConfirmCancelId(null);
        } catch (error: any) {
            Alert.alert('Could not cancel', error?.message || 'Please try again.');
        } finally {
            setCancellingId(null);
        }
    };


    const handleSubmitRating = async (orderId: string) => {
        if (ratingStars < 1) { Alert.alert('Pick a rating', 'Tap a star to rate from 1 to 5.'); return; }
        setSubmittingRating(true);
        try {
            const submit = getFunctionsInstance().httpsCallable('submitOrderRating');
            const fb = ratingFeedback.trim();
            await submit({ orderId, rating: ratingStars, feedback: fb || undefined });
            // Optimistic: the sync effect will reconcile with the server snapshot.
            setSelectedOrder(prev => prev ? ({ ...prev, rating: ratingStars, feedback: fb || undefined } as RentalOrder) : prev);
            setRatingStars(0); setRatingFeedback('');
        } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not submit rating.');
        } finally {
            setSubmittingRating(false);
        }
    };

    const handleAddTip = async (orderId: string, amount: number) => {
        if (!amount || amount <= 0) { Alert.alert('Enter a tip', 'Choose a preset or enter a custom amount.'); return; }
        setSubmittingTip(true);
        try {
            const createTip = getFunctionsInstance().httpsCallable('createTipPaymentIntent');
            const res: any = await createTip({ orderId, tipAmount: amount });
            const data = res?.data ?? {};

            // Saved card → charged off-session server-side. No saved card / auth needed →
            // a clientSecret comes back for the payment sheet; the webhook records the tip.
            if (!data.charged && data.clientSecret) {
                const { error: initError } = await initPaymentSheet({
                    merchantDisplayName: 'Foodyzz',
                    paymentIntentClientSecret: data.clientSecret,
                    defaultBillingDetails: { phone: user?.phoneNumber || undefined },
                    allowsDelayedPaymentMethods: false,
                });
                if (initError) { Alert.alert('Payment Setup Error', initError.message); return; }
                const { error: presentError } = await presentPaymentSheet();
                if (presentError) {
                    if (presentError.code !== 'Canceled') Alert.alert('Payment Error', presentError.message);
                    return;
                }
            }

            // Optimistic; the sync effect reconciles with the server-recorded tip.
            setSelectedOrder(prev => prev ? ({ ...prev, tip: amount } as RentalOrder) : prev);
            setTipChoice(null); setTipCustom('');
            Alert.alert('Thank you! 🎉', `Your $${amount.toFixed(2)} tip was sent to your provider.`);
        } catch (e: any) {
            Alert.alert('Error', e?.message || 'Could not add tip.');
        } finally {
            setSubmittingTip(false);
        }
    };

    const handlePayoff = (order: RentalOrder) => {
        const sched = order.billingSchedule;
        if (!sched) return;
        const monthsLeft = Math.max(0, sched.periodsTotal - sched.periodsCharged);
        if (monthsLeft <= 0) return;
        const amount = monthsLeft * sched.perPeriodAmount;
        Alert.alert(
            'Pay off your bike?',
            `This charges the remaining ${monthsLeft} month${monthsLeft === 1 ? '' : 's'} — $${amount.toFixed(2)} — to your saved card now. ` +
            'The bike becomes yours and any deposit is released. This cannot be undone.',
            [
                { text: 'Not now', style: 'cancel' },
                {
                    text: `Pay $${amount.toFixed(2)}`,
                    onPress: async () => {
                        setPayingOffId(order.id);
                        try {
                            const res: any = await getFunctionsInstance().httpsCallable('payoffRentToBuy')({ orderId: order.id });
                            if (res?.data?.alreadyOwned) {
                                Alert.alert('Already yours', 'This bike is already paid off.');
                            } else {
                                Alert.alert('Congratulations! 🎉', 'Your bike is paid off and now yours to keep.');
                            }
                        } catch (e: any) {
                            Alert.alert('Payment failed', e?.message || 'Could not complete the payoff. Please try again.');
                        } finally {
                            setPayingOffId(null);
                        }
                    },
                },
            ],
        );
    };

    const handleReorder = (order: any) => {
        navigation.navigate('Wizard', {
            initialRentalType: order.rentalType,
            initialBikeModel: order.bikeModel,
            initialDurationValue: order.durationValue,
            initialNotes: order.notes,
            initialPickupDay: order.pickupDay,
            initialPickupTimeWindow: order.pickupTimeWindow,
            initialIsPickup: order.logisticsType === 'pickupDelivery',
        });
    };

    const renderStatusProgress = (order: RentalOrder) => {
        const { status } = order;
        const currentIdx = orderStepIndex(order);

        if (status === OrderStatus.CANCELLED) {
            return (
                <View className="bg-rose-50 p-3 rounded-xl border border-rose-200 mt-4">
                    <Text className="text-rose-600 text-center font-bold text-[10px] uppercase">Order Cancelled</Text>
                </View>
            );
        }


        return (
            <View className="my-6">
                <View className="flex-row justify-between relative">
                    {/* Background Line */}
                    <View className="absolute top-3.5 left-0 right-0 h-1 bg-slate-100" />
                    {/* Progress Line */}
                    <View
                        style={{ width: `${(currentIdx / (OrderSteps.length - 1)) * 100}%` }}
                        className="absolute top-3.5 left-0 h-1 bg-indigo-600 transition-all"
                    />

                    {OrderSteps.map((step, i) => {
                        const isDone = i <= currentIdx;
                        const isCurrent = i === currentIdx;
                        // The verify step reads "ID Pending" (orange) while the order is
                        // sitting there waiting on documents the customer hasn't sent.
                        const isIdPending = i === VERIFY_STEP && isCurrent && !idOnFile;
                        return (
                            <View key={step.key} className="items-center z-10 w-1/5">
                                <View
                                    style={isIdPending ? { backgroundColor: ID_PENDING_ORANGE } : undefined}
                                    className={`w-8 h-8 rounded-full items-center justify-center border-2 ${isIdPending ? 'border-black shadow-sm' : isCurrent ? 'bg-indigo-600 border-black shadow-sm' : isDone ? 'bg-indigo-500 border-indigo-600' : 'bg-white border-slate-200'
                                        }`}>
                                    <Text className={`text-[10px] font-black ${isDone ? 'text-white' : 'text-slate-300'}`}>{i + 1}</Text>
                                </View>
                                <Text
                                    style={isIdPending ? { color: ID_PENDING_ORANGE } : undefined}
                                    className={`text-[8px] font-black uppercase mt-2 tracking-tighter ${isDone ? 'text-indigo-600' : 'text-slate-400'}`}>
                                    {isIdPending ? 'ID Pending' : step.label}
                                </Text>
                            </View>
                        );
                    })}
                </View>
            </View>
        );
    };

    if (loading) {
        return (
            <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator color="#507425" />
            </View>
        );
    }

    return (
        <ScrollView className="flex-1 bg-white pt-4 px-4" showsVerticalScrollIndicator={false}>

            {/* Active Orders Section */}
            <View className="mb-8">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-1">
                    Active Requests ({activeOrders.length})
                </Text>

                {activeOrders.length === 0 ? (
                    <View className="p-8 border-2 border-dashed border-slate-200 rounded-[32px] items-center">
                        <Clock size={32} color="#cbd5e1" />
                        <Text className="text-slate-400 font-bold text-xs mt-3 uppercase">No active queue</Text>
                    </View>
                ) : (
                    activeOrders.map((order) => (
                        <TouchableOpacity
                            key={order.id}
                            onPress={() => setSelectedOrder(order)}
                            activeOpacity={0.9}
                            className="bg-white border-2 border-black rounded-[32px] p-5 shadow-brutalist mb-4"
                        >
                            <View className="border-b border-slate-100 pb-3">
                                <View className="flex-row items-center gap-2">
                                    <View className="bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
                                        <Text className="text-indigo-600 font-mono font-black text-[9px] uppercase">{order.id}</Text>
                                    </View>
                                    {order.customerUnreadMessage && (
                                        <View className="flex-row items-center gap-1">
                                            <View className="w-2 h-2 rounded-full bg-indigo-600" />
                                            <Text className="text-indigo-600 font-black text-[8px] uppercase tracking-tight">New reply</Text>
                                        </View>
                                    )}
                                    {/* Only while genuinely still finding a provider. Once the
                                        order advances past 'requested' (a provider engaged it)
                                        the stepper lights CONFIRMED, so the "Broadcasting..."
                                        badge must clear too — even if providerId still lags on
                                        the 'broadcast' sentinel. Keyed on status, like the stepper. */}
                                    {order.providerId === 'broadcast' && order.status === OrderStatus.REQUESTED && (
                                        <Text className="text-brand-green-dark font-black text-[8px] uppercase animate-pulse">Broadcasting...</Text>
                                    )}
                                    {/* Directed order the store hasn't accepted yet — the customer
                                        picked this store, so show it's assigned and awaiting the
                                        provider's confirmation (not the broadcast "finding" state). */}
                                    {order.providerId !== 'broadcast' && order.status === OrderStatus.REQUESTED && (
                                        <Text className="text-indigo-500 font-black text-[8px] uppercase">Awaiting confirmation</Text>
                                    )}
                                </View>
                                <Text className="text-sm font-black text-black uppercase mt-1">
                                    {order.providerId === 'broadcast' && order.status === OrderStatus.REQUESTED
                                        ? 'Finding Provider'
                                        : (order.providerName || 'Selected Provider')}
                                </Text>
                                {/* Price sits on its own full-card-width row below the provider name,
                                    right-justified. Previously it shared the header row with the badge/
                                    status/name via justify-between; the price column doesn't shrink, so a
                                    long order-id badge pushed multi-digit prices (e.g. $15.78) past the
                                    card's right edge. A dedicated row can never overflow. */}
                                <View className="items-end mt-1">
                                    <Text className={`text-lg font-black ${false ? 'text-amber-500' : order.finalPrice ? 'text-emerald-600' : 'text-indigo-600'}`}>
                                        ${(order.finalPrice ?? order.estimatedPrice).toFixed(2)}
                                    </Text>
                                    {false ? (
                                        <Text className="text-[7px] font-black text-amber-500 uppercase tracking-tighter">Pending</Text>
                                    ) : order.finalPrice ? (
                                        <Text className="text-[7px] font-black text-slate-400 uppercase tracking-tighter">
                                            Confirmed
                                        </Text>
                                    ) : null}
                                </View>
                            </View>

                            {renderStatusProgress(order)}

                            {/* Sits between the stepper and the chat button, and ONLY while
                                the order is parked on the ID-Pending step — it's the single
                                action that unblocks it. Tapping goes straight to Account,
                                where IdentityDocumentsCard lives. */}
                            {order.status !== OrderStatus.CANCELLED
                                && orderStepIndex(order) === VERIFY_STEP
                                && !idOnFile && (
                                <TouchableOpacity
                                    onPress={() => navigation.navigate('Main', { screen: 'Account' })}
                                    style={{ backgroundColor: '#fff7ed', borderColor: ID_PENDING_ORANGE }}
                                    className="border-2 rounded-2xl px-4 py-3 flex-row items-center gap-2"
                                >
                                    <AlertTriangle size={14} color={ID_PENDING_ORANGE} />
                                    <Text style={{ color: '#9a3412' }} className="flex-1 text-[10px] font-black uppercase leading-relaxed">
                                        Upload your ID & proof of address — go to Account
                                    </Text>
                                    <ChevronRight size={14} color={ID_PENDING_ORANGE} />
                                </TouchableOpacity>
                            )}

                            {/* Per-order chat with FoodyzzHQ (order-to-order, `messages`
                                collection) reduced to an icon on the left, with Cancel taking
                                the rest of the row. The chat icon still alerts in place when HQ
                                has replied — indigo fill + a dot, driven by
                                order.customerUnreadMessage. Cancel greys out for good once
                                FoodyzzHQ marks the order ready for delivery. */}
                            {(() => {
                                const cancellable = CANCELLABLE_STATUSES.includes(order.status);
                                const cancelling = cancellingId === order.id;
                                const arming = confirmCancelId === order.id;
                                return (
                                    <View className="flex-row gap-2 mt-3">
                                        <TouchableOpacity
                                            onPress={() => navigation.navigate('OrderChat', { orderId: order.id })}
                                            accessibilityLabel={order.customerUnreadMessage ? 'Open chat — new reply' : 'Open chat'}
                                            className={`px-5 py-3 rounded-xl border-2 items-center justify-center ${order.customerUnreadMessage ? 'bg-indigo-600 border-black' : 'bg-white border-slate-100'}`}
                                        >
                                            <MessageCircle size={16} color={order.customerUnreadMessage ? '#ffffff' : '#507425'} />
                                            {order.customerUnreadMessage && (
                                                <View className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-white" />
                                            )}
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            disabled={!cancellable || cancelling}
                                            onPress={() => arming ? handleCancelOrder(order.id) : setConfirmCancelId(order.id)}
                                            className={`flex-1 py-3 rounded-xl border-2 items-center justify-center ${!cancellable ? 'bg-slate-50 border-slate-100' : arming ? 'bg-rose-600 border-black' : 'bg-white border-slate-100'}`}
                                        >
                                            {cancelling ? (
                                                <ActivityIndicator size="small" color="#ffffff" />
                                            ) : (
                                                <Text className={`font-black text-[10px] uppercase ${!cancellable ? 'text-slate-300' : arming ? 'text-white' : 'text-slate-400'}`}>
                                                    {arming && cancellable ? 'Confirm?' : 'Cancel'}
                                                </Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                );
                            })()}
                        </TouchableOpacity>
                    ))
                )}
            </View>

            {/* Rent-to-Buy financing — active + past-due installment plans. */}
            {(() => {
                const financingOrders = [...activeOrders, ...pastOrders].filter(
                    (o) => o.rentalType === 'rentToBuy' && o.billingSchedule &&
                        (o.billingSchedule.status === 'active' || o.billingSchedule.status === 'past_due'),
                );
                if (financingOrders.length === 0) return null;
                return (
                    <View className="mb-8">
                        <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-1">
                            Rent-to-Buy ({financingOrders.length})
                        </Text>
                        {financingOrders.map((order) => {
                            const sched = order.billingSchedule!;
                            const pastDue = sched.status === 'past_due';
                            const monthsLeft = Math.max(0, sched.periodsTotal - sched.periodsCharged);
                            const remainingAmount = monthsLeft * sched.perPeriodAmount;
                            const progressPct = Math.round((sched.periodsCharged / sched.periodsTotal) * 100);
                            const nextDate = sched.nextChargeAt
                                ? new Date(sched.nextChargeAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                : null;
                            // Pink when on-track; a darker pink with an exclamation watermark when a
                            // payment has failed and the plan is past due.
                            const bg = pastDue ? '#F9A8D4' : '#FCE7F3';
                            const border = pastDue ? '#BE185D' : '#F9A8D4';
                            const bikeName = order.bikeModel ? `Model ${order.bikeModel}` : 'Your bike';
                            return (
                                <View
                                    key={order.id}
                                    style={{ backgroundColor: bg, borderColor: border, borderWidth: 2, overflow: 'hidden' }}
                                    className="rounded-[28px] p-5 mb-4"
                                >
                                    {/* Exclamation watermark on a failed plan */}
                                    {pastDue && (
                                        <View style={{ position: 'absolute', top: -18, right: -12, opacity: 0.18 }} pointerEvents="none">
                                            <AlertTriangle size={128} color="#7f1d1d" />
                                        </View>
                                    )}

                                    <View className="flex-row items-center justify-between">
                                        <View className="flex-row items-center gap-2">
                                            <View style={{ backgroundColor: pastDue ? '#BE185D' : '#DB2777' }} className="px-2 py-0.5 rounded">
                                                <Text className="text-white font-black text-[8px] uppercase tracking-wide">Rent-to-Buy</Text>
                                            </View>
                                            <Text className="text-[9px] font-mono font-bold" style={{ color: pastDue ? '#831843' : '#9D174D' }}>{order.id}</Text>
                                        </View>
                                        {pastDue && (
                                            <View className="flex-row items-center gap-1">
                                                <AlertTriangle size={13} color="#7f1d1d" />
                                                <Text className="text-[9px] font-black uppercase" style={{ color: '#7f1d1d' }}>Payment failed</Text>
                                            </View>
                                        )}
                                    </View>

                                    <Text className="text-base font-black text-slate-900 uppercase mt-2">{bikeName}</Text>

                                    <View className="flex-row items-end justify-between mt-1">
                                        <View>
                                            <Text className="text-3xl font-black" style={{ color: '#831843' }}>{monthsLeft}</Text>
                                            <Text className="text-[10px] font-black uppercase tracking-wide" style={{ color: '#9D174D' }}>
                                                month{monthsLeft === 1 ? '' : 's'} left
                                            </Text>
                                        </View>
                                        <Text className="text-[11px] font-bold text-slate-700 mb-1">
                                            {sched.periodsCharged} of {sched.periodsTotal} paid
                                        </Text>
                                    </View>

                                    {/* Progress bar */}
                                    <View style={{ backgroundColor: '#ffffff80' }} className="h-2 rounded-full mt-2 overflow-hidden">
                                        <View style={{ width: `${progressPct}%`, backgroundColor: '#BE185D' }} className="h-full rounded-full" />
                                    </View>

                                    <Text className="text-[12px] font-bold mt-3" style={{ color: pastDue ? '#7f1d1d' : '#831843' }}>
                                        {pastDue
                                            ? "We couldn't take your last payment. Update your card — our team will reach out to help."
                                            : nextDate
                                                ? `Next payment $${sched.perPeriodAmount.toFixed(2)} on ${nextDate}.`
                                                : `$${sched.perPeriodAmount.toFixed(2)} per month.`}
                                    </Text>

                                    <TouchableOpacity
                                        onPress={() => handlePayoff(order)}
                                        disabled={payingOffId === order.id}
                                        className="mt-4 py-3 rounded-2xl border-2 border-black items-center justify-center flex-row"
                                        style={{ backgroundColor: '#ffffff', opacity: payingOffId === order.id ? 0.6 : 1 }}
                                    >
                                        {payingOffId === order.id ? (
                                            <ActivityIndicator color="#000000" />
                                        ) : (
                                            <Text className="font-black text-[11px] uppercase tracking-wide text-black">
                                                Pay off remaining · ${remainingAmount.toFixed(2)}
                                            </Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            );
                        })}
                    </View>
                );
            })()}

            {/* History Section — excludes rent-to-buy plans still being paid off (those
                live in the Rent-to-Buy section above until the bike is owned). */}
            {(() => {
                const historyOrders = pastOrders.filter(
                    (o) => !(o.rentalType === 'rentToBuy' && o.billingSchedule &&
                        (o.billingSchedule.status === 'active' || o.billingSchedule.status === 'past_due')),
                );
                return (
            <View className="mb-12">
                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 px-1">
                    Service History ({historyOrders.length})
                </Text>

                {historyOrders.map((order) => (
                    <TouchableOpacity
                        key={order.id}
                        onPress={() => setSelectedOrder(order)}
                        activeOpacity={0.8}
                        className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mb-3"
                    >
                        <View className="flex-row justify-between items-start">
                            <View className="flex-1 mr-3">
                                <View className="flex-row items-center gap-2 mb-2">
                                    <Text className="text-[9px] font-mono font-bold text-slate-400">{order.id}</Text>
                                    <View className={`px-1.5 py-0.5 rounded ${order.status === 'cancelled' ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                                        <Text style={{ color: order.status === 'cancelled' ? '#e11d48' : '#059669', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' }}>
                                            {historyStatusLabel(order)}
                                        </Text>
                                    </View>
                                </View>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', textTransform: 'uppercase' }}>
                                    {order.providerName || 'Provider'}
                                </Text>
                                <Text style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                                    {new Date(order.createdAt).toLocaleDateString()}
                                </Text>
                            </View>
                            <View className="items-end">
                                <Text style={{ fontSize: 13, fontWeight: '900', color: '#334155' }}>
                                    ${order.finalPrice?.toFixed(2) ?? order.estimatedPrice.toFixed(2)}
                                </Text>
                                <ChevronRight size={14} color="#cbd5e1" />
                            </View>
                        </View>
                    </TouchableOpacity>
                ))}
            </View>
                );
            })()}

            <View className="h-24" />

            {/* Order Detail Modal */}
            <Modal visible={!!selectedOrder} animationType="slide" transparent={true}>
                <View className="flex-1 bg-black/60 justify-end">
                    <View className="bg-white border-t-4 border-black rounded-t-[44px] p-6 h-[75%]">
                        <View className="flex-row justify-between items-start mb-6">
                            <View>
                                <View className="bg-indigo-50 self-start px-2 py-1 rounded border border-indigo-100 mb-1">
                                    <Text className="text-indigo-600 font-mono font-black text-[10px]">REF: {selectedOrder?.id}</Text>
                                </View>
                                <Text className="text-2xl font-black text-black uppercase tracking-tighter">Order Details</Text>
                            </View>
                            <TouchableOpacity onPress={() => setSelectedOrder(null)} className="p-2 bg-slate-100 rounded-full">
                                <X size={20} color="black" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} className="space-y-4">
                            {/* Real-time Order Tracking Visualization */}
                            {selectedOrder?.providerLocation && LIVE_TRACKING_STATUSES.includes(selectedOrder?.status) && (
                                <View className="bg-slate-900 h-48 rounded-3xl border-2 border-black overflow-hidden">
                                    <MapView
                                        style={{ flex: 1 }}
                                        initialRegion={{
                                            latitude: selectedOrder.providerLocation.lat,
                                            longitude: selectedOrder.providerLocation.lng,
                                            latitudeDelta: 0.02,
                                            longitudeDelta: 0.02,
                                        }}
                                        scrollEnabled={false}
                                        zoomEnabled={false}
                                    >
                                        <Marker
                                            coordinate={{
                                                latitude: selectedOrder.providerLocation.lat,
                                                longitude: selectedOrder.providerLocation.lng,
                                            }}
                                            title="Provider"
                                            description={selectedOrder.providerCurrentStatus}
                                        />
                                    </MapView>
                                    <Text className="absolute bottom-2 left-4 text-white font-mono text-[9px] uppercase font-black">Provider: {selectedOrder.providerCurrentStatus}</Text>
                                </View>
                            )}

                            <View className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Rental Breakdown</Text>
                                <View className="flex-row justify-between mb-2">
                                    <Text className="text-xs font-bold text-slate-600">Bike</Text>
                                    <Text className="text-xs font-black text-black">
                                        Model {selectedOrder?.bikeModel ?? '—'}{selectedOrder?.bikeNo ? ` · #${selectedOrder.bikeNo}` : ''}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between mb-2">
                                    <Text className="text-xs font-bold text-slate-600">Type</Text>
                                    <Text className="text-xs font-black text-black">
                                        {selectedOrder?.rentalType === 'rentToBuy' ? 'Rent to Buy'
                                          : selectedOrder?.rentalType === 'buy' ? 'Buy' : 'Rent'}
                                    </Text>
                                </View>
                                <View className="flex-row justify-between">
                                    <Text className="text-xs font-bold text-slate-600">Term</Text>
                                    <Text className="text-xs font-black text-black">
                                        {selectedOrder?.durationValue
                                          ? `${selectedOrder.durationValue} ${selectedOrder.durationUnit ?? ''}`
                                          : '—'}
                                    </Text>
                                </View>
                            </View>

                            <View className="bg-slate-50 p-4 rounded-3xl border border-slate-100">
                                <Text className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Logistics</Text>
                                <View className="flex-row items-center gap-3 mb-3">
                                    <Clock size={16} color={COLORS.brand.greenDark} />
                                    <View>
                                        <Text className="text-[10px] font-bold text-slate-400 uppercase">Need By</Text>
                                        <Text className="text-xs font-bold text-black">{formatNeedBy(selectedOrder?.needBy)}</Text>
                                    </View>
                                </View>
                                <View className="flex-row items-center gap-3">
                                    <CheckCircle size={16} color={COLORS.status.completed} />
                                    <View>
                                        <Text className="text-[10px] font-bold text-slate-400 uppercase">Pickup Location</Text>
                                        <Text className="text-xs font-bold text-black">{selectedOrder?.customerAddress}</Text>
                                    </View>
                                </View>
                            </View>

                            <View style={{ flexDirection: 'row', borderRadius: 28, borderWidth: 2, borderColor: 'black', overflow: 'hidden' }} className="shadow-brutalist">
                                {/* Payment info — 2/3 */}
                                <View style={{ flex: 2, backgroundColor: false ? '#92400e' : '#507425', padding: 20, justifyContent: 'center' }}>
                                    <Text style={{ color: false ? '#fde68a' : '#a5b4fc', fontSize: 9, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
                                        {false
                                            ? 'Awaiting Your Approval'
                                            : selectedOrder?.chargedAmount != null
                                                ? 'Charged'
                                                : selectedOrder?.finalPrice ? 'Authorized' : 'Authorized Deposit'}
                                    </Text>
                                    <Text style={{ color: 'white', fontSize: 26, fontWeight: '900', lineHeight: 30 }}>
                                        {/* Prefer the ACTUAL captured amount once charged; before capture show the
                                            settlement (finalPrice) or the authorized hold (estimatedPrice). */}
                                        ${(selectedOrder?.chargedAmount ?? selectedOrder?.finalPrice ?? selectedOrder?.estimatedPrice ?? 0).toFixed(2)}
                                    </Text>
                                    {false ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                            <AlertTriangle size={10} color="#fbbf24" />
                                            <Text style={{ color: '#fbbf24', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' }}>Review Required</Text>
                                        </View>
                                    ) : !!selectedOrder?.finalPrice ? (
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                                            <CheckCircle size={10} color="#6ee7b7" />
                                            <Text style={{ color: '#6ee7b7', fontSize: 8, fontWeight: '900', textTransform: 'uppercase' }}>Transaction Complete</Text>
                                        </View>
                                    ) : null}
                                </View>
                                {/* QR Code — 1/3 */}
                                <View style={{ flex: 1, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', padding: 10 }}>
                                    <QRCode
                                        value={selectedOrder?.id ?? 'ORDER'}
                                        size={74}
                                        color="#000000"
                                        backgroundColor="#ffffff"
                                    />
                                </View>
                            </View>

                            {/* Charges Detail */}
                            <View className="bg-white border-2 border-black rounded-[28px] overflow-hidden">

                                {/* Original estimate — always visible */}
                                <View className="px-4 pt-4 pb-3">
                                    <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                        {selectedOrder?.finalPrice ? 'Authorized (Max)' : 'Charges'}
                                    </Text>
                                    {selectedOrder?.orderSubtotal != null && (
                                        <View className="flex-row justify-between mb-2">
                                            <Text className="text-xs text-slate-500 font-bold">Order Subtotal</Text>
                                            <Text className="text-xs font-black text-slate-800">${(selectedOrder.orderSubtotal as number).toFixed(2)}</Text>
                                        </View>
                                    )}
                                    {selectedOrder?.deliveryFee != null && (
                                        <View className="flex-row justify-between mb-2">
                                            <Text className="text-xs text-slate-500 font-bold">Pickup & Delivery</Text>
                                            <Text className="text-xs font-black text-slate-800">${(selectedOrder.deliveryFee as number).toFixed(2)}</Text>
                                        </View>
                                    )}
                                    {selectedOrder?.platformFee != null && selectedOrder.platformFee > 0 && (
                                        <View className="flex-row justify-between mb-2">
                                            <Text className="text-xs text-slate-500 font-bold">Platform Fee</Text>
                                            <Text className="text-xs font-black text-slate-800">${(selectedOrder.platformFee as number).toFixed(2)}</Text>
                                        </View>
                                    )}
                                    {/* Customer view combines sales tax + card processing into one
                                        "Taxes and fees" line; FoodyzzHQ (admin) still itemizes them. */}
                                    {(selectedOrder?.tax != null || selectedOrder?.ccProcessingFee != null) && (
                                        <View className="flex-row justify-between mb-2">
                                            <Text className="text-xs text-slate-500 font-bold">Taxes and fees</Text>
                                            <Text className="text-xs font-black text-slate-800">
                                                ${((Number(selectedOrder?.tax ?? 0)) + (Number(selectedOrder?.ccProcessingFee ?? 0))).toFixed(2)}
                                            </Text>
                                        </View>
                                    )}
                                    {selectedOrder?.couponCode && (
                                        <View className="flex-row justify-between mb-2">
                                            <Text className="text-xs text-emerald-600 font-bold">Coupon ({selectedOrder.couponCode})</Text>
                                            <Text className="text-xs font-black text-emerald-600">
                                                {selectedOrder.couponDiscount != null ? `−$${(selectedOrder.couponDiscount as number).toFixed(2)}` : 'Applied'}
                                            </Text>
                                        </View>
                                    )}
                                    <View className="flex-row justify-between pt-2 border-t border-slate-100">
                                        <Text className="text-xs text-slate-500 font-bold">Total Authorized</Text>
                                        <Text className="text-xs font-black text-slate-800">${selectedOrder?.estimatedPrice?.toFixed(2)}</Text>
                                    </View>
                                    {/* Once the card is actually charged, show the real captured amount. */}
                                    {selectedOrder?.chargedAmount != null && (
                                        <View className="flex-row justify-between pt-2">
                                            <Text className="text-xs text-emerald-600 font-bold">Total Charged</Text>
                                            <Text className="text-xs font-black text-emerald-700">${(selectedOrder.chargedAmount as number).toFixed(2)}</Text>
                                        </View>
                                    )}
                                </View>

                            </View>

                            {/* Rate + tip, once the rental is complete. The provider
                                price-adjustment approval flow that used to sit here is
                                gone: a rental is quoted in full up front and never re-priced. */}
                            {selectedOrder?.status === OrderStatus.DELIVERED && (
                                <View className="space-y-4">
                                    {/* Rating */}
                                    <View className="bg-white border-2 border-black rounded-[28px] p-4">
                                        <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                            {selectedOrder.rating ? 'Your Rating' : 'Rate Your Rental'}
                                        </Text>
                                        {selectedOrder.rating ? (
                                            <View className="flex-row items-center gap-2">
                                                <Star size={16} color="#f59e0b" fill="#f59e0b" />
                                                <Text className="text-sm font-black text-slate-700">
                                                    {selectedOrder.rating} / 5 — thank you!
                                                </Text>
                                            </View>
                                        ) : (
                                            <>
                                                <View className="flex-row justify-between mb-3 px-2">
                                                    {[1, 2, 3, 4, 5].map(n => (
                                                        <TouchableOpacity key={n} onPress={() => setRatingStars(n)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                                                            <Star size={34} color="#f59e0b" fill={n <= ratingStars ? '#f59e0b' : 'transparent'} />
                                                        </TouchableOpacity>
                                                    ))}
                                                </View>
                                                <TextInput
                                                    value={ratingFeedback}
                                                    onChangeText={setRatingFeedback}
                                                    placeholder="Add a note (optional)"
                                                    placeholderTextColor="#94a3b8"
                                                    multiline
                                                    maxLength={500}
                                                    className="border-2 border-slate-200 rounded-2xl px-3 py-2 text-xs text-black mb-3"
                                                    style={{ minHeight: 44 }}
                                                />
                                                <TouchableOpacity
                                                    onPress={() => handleSubmitRating(selectedOrder.id)}
                                                    disabled={submittingRating || ratingStars < 1}
                                                    className={`py-3 rounded-xl items-center border-2 border-black ${submittingRating || ratingStars < 1 ? 'bg-slate-200' : 'bg-black'}`}
                                                >
                                                    {submittingRating ? (
                                                        <ActivityIndicator size="small" color="#000" />
                                                    ) : (
                                                        <Text className={`font-black text-[10px] uppercase tracking-widest ${ratingStars < 1 ? 'text-slate-400' : 'text-white'}`}>Submit Rating</Text>
                                                    )}
                                                </TouchableOpacity>
                                            </>
                                        )}
                                    </View>

                                    {/* Tip */}
                                    <View className="bg-white border-2 border-black rounded-[28px] p-4">
                                        <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-3">
                                            {selectedOrder.tip ? 'Tip' : 'Add a Tip'}
                                        </Text>
                                        {selectedOrder.tip ? (
                                            <View className="flex-row items-center gap-2">
                                                <CheckCircle size={16} color="#10b981" />
                                                <Text className="text-sm font-black text-emerald-700">Tip added: ${selectedOrder.tip.toFixed(2)} — thank you!</Text>
                                            </View>
                                        ) : (() => {
                                            const base = selectedOrder.orderSubtotal ?? selectedOrder.chargedAmount ?? selectedOrder.finalPrice ?? selectedOrder.estimatedPrice ?? 0;
                                            const custom = parseFloat(tipCustom);
                                            const amount = !isNaN(custom) && custom > 0 ? Math.round(custom * 100) / 100 : (tipChoice ?? 0);
                                            return (
                                                <>
                                                    <Text className="text-[10px] text-slate-500 font-bold mb-3">100% of your tip goes to your provider.</Text>
                                                    <View className="flex-row gap-2 mb-3">
                                                        {[0.15, 0.18, 0.20].map(pct => {
                                                            const amt = Math.round(base * pct * 100) / 100;
                                                            const active = !tipCustom && tipChoice === amt;
                                                            return (
                                                                <TouchableOpacity
                                                                    key={pct}
                                                                    onPress={() => { setTipChoice(amt); setTipCustom(''); }}
                                                                    className={`flex-1 py-2.5 rounded-xl items-center border-2 border-black ${active ? 'bg-indigo-600' : 'bg-slate-50'}`}
                                                                >
                                                                    <Text className={`font-black text-[11px] ${active ? 'text-white' : 'text-slate-700'}`}>{Math.round(pct * 100)}%</Text>
                                                                    <Text className={`text-[8px] font-bold ${active ? 'text-indigo-100' : 'text-slate-400'}`}>${amt.toFixed(2)}</Text>
                                                                </TouchableOpacity>
                                                            );
                                                        })}
                                                    </View>
                                                    <View className="flex-row items-center border-2 border-slate-200 rounded-2xl px-3 mb-3">
                                                        <Text className="text-slate-400 font-black text-sm mr-1">$</Text>
                                                        <TextInput
                                                            value={tipCustom}
                                                            onChangeText={(t) => { setTipCustom(t.replace(/[^0-9.]/g, '')); setTipChoice(null); }}
                                                            placeholder="Custom amount"
                                                            placeholderTextColor="#94a3b8"
                                                            keyboardType="decimal-pad"
                                                            className="flex-1 py-2.5 text-sm text-black"
                                                        />
                                                    </View>
                                                    <TouchableOpacity
                                                        onPress={() => handleAddTip(selectedOrder.id, amount)}
                                                        disabled={submittingTip || amount <= 0}
                                                        className={`py-3 rounded-xl items-center border-2 border-black ${submittingTip || amount <= 0 ? 'bg-slate-200' : 'bg-indigo-600'}`}
                                                    >
                                                        {submittingTip ? (
                                                            <ActivityIndicator size="small" color="#000" />
                                                        ) : (
                                                            <Text className={`font-black text-[10px] uppercase tracking-widest ${amount <= 0 ? 'text-slate-400' : 'text-white'}`}>
                                                                {amount > 0 ? `Add $${amount.toFixed(2)} Tip` : 'Add Tip'}
                                                            </Text>
                                                        )}
                                                    </TouchableOpacity>
                                                </>
                                            );
                                        })()}
                                    </View>
                                </View>
                            )}

                            <View className="h-10" />
                        </ScrollView>
                    </View>
                </View>
            </Modal>
        </ScrollView>
    );
}
