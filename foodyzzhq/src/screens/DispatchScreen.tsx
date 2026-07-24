import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, FlatList, TouchableOpacity, ActivityIndicator, Alert, Modal, TextInput, Linking, KeyboardAvoidingView, Platform, ScrollView, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Building, Zap, Clock, MapPin, CheckCircle, X, Truck, RefreshCcw, Bike, Package, Phone, Power, Sun, User } from 'lucide-react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { COLORS } from '../theme';
import { db } from '../services/firebase';
import { useActiveProvider, useGlobalConfig, useProviderOrders, useBikeInventory } from '../hooks';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { OrderStatus, RentalOrder } from '../types';
import { getScheduleLines } from '../utils/schedule';
import ProviderNotes from '../components/ProviderNotes';
import CustomerIdCard from '../components/CustomerIdCard';
import { getCurrentProviderCoords, warnLocationUnavailableOnce } from '../utils/location';


export default function DispatchScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation();
  const functions = firebase.app().functions('us-central1');

  // Shared hooks replace the per-screen config/provider/orders listener block.
  // Every Foodyzz order names its store at checkout, so the feed is simply this
  // store's assignments — there is no broadcast pool to filter.
  const config = useGlobalConfig();
  const { models: inventory } = useBikeInventory();
  const { profile: providerProfile, loading: providerLoading } = useActiveProvider();
  const { orders, loading: ordersLoading, applyOptimistic, clearOptimistic } = useProviderOrders(providerProfile?.id, {
    statuses: ['requested', 'confirmed', 'en_route_pickup', 'at_pickup', 'pending_customer_confirmation'],
    // Safety read-cap on the feed.
    limitTo: 100,
  });
  const loading = providerLoading || (!!providerProfile?.id && ordersLoading);

  // A blocked or self-paused store still sees its in-flight work; the customer app
  // simply stops offering it as a pickable location.
  const isBlocked = !!providerProfile?.isBlocked;
  const servicesActive = providerProfile?.servicesActive ?? true;
  const visibleOrders = orders;

  const [processingOrderId, setProcessingOrderId] = useState<string | null>(null);

  // Guards trailing setState after network awaits: switching store re-keys and unmounts
  // this screen (App.tsx key={activeStoreZip}) while a claim/status round-trip is in flight.
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  // Last reminder body returned by the backend, reused verbatim for a manual SMS.

  // One-time "who referred you?" prompt. Shows the first time an onboarded store
  // enters the command center, unless they already answered or already have a
  // referral linked. Goal is purely to capture a school manager's referral code.




  // Optional "keep screen awake" so a store can leave the dispatch feed visible
  // on a counter display without the device dimming/locking. Tied to a single
  // tag so it cleans up when toggled off or when the screen unmounts.
  const [keepAwake, setKeepAwake] = useState(false);
  useEffect(() => {
    if (!keepAwake) return;
    activateKeepAwakeAsync('dispatch-feed').catch(() => {});
    return () => { deactivateKeepAwake('dispatch-feed').catch(() => {}); };
  }, [keepAwake]);

  const handleCancelOrder = (orderId: string) => {
    Alert.alert(
      "Cancel Order",
      "Are you sure? Cancellations are tracked and may affect your performance rating.",
      [
        { text: "No", style: "cancel" },
        { 
          text: "Yes, Cancel", 
          style: "destructive",
          onPress: async () => {
            try {
              const cancelCall = functions.httpsCallable('cancelOrder');
              await cancelCall({ orderId, reason: "Provider Manual Cancellation" });
              Alert.alert("Success", "Order cancelled and customer notified.");
            } catch (error: any) {
              Alert.alert("Cancellation Failed", error.message);
            }
          }
        }
      ]
    );
  };

  // Reminder wording for a provider-composed SMS. Deliberately AMOUNT-FREE: the
  // customer's charge/total is never shown to the provider. The backend's own
  // approval SMS (sent directly to the customer) includes the figure; this manual
  // fallback just nudges the customer to open the app.
  const approvalSmsBody = (order: RentalOrder) =>
    `Reminder: rental ${order.id.replace('order_', '#')} has an updated total awaiting your approval. Please open the app to review and approve or decline.`;

  // Open the phone's Messages app pre-filled with the reminder (iOS uses `&body`,
  // Android `?body`), so the provider can send it directly.
  const openCustomerSms = (phone: string, body: string) => {
    const sep = Platform.OS === 'ios' ? '&' : '?';
    Linking.openURL(`sms:${phone}${sep}body=${encodeURIComponent(body)}`).catch(() => {
      Alert.alert("Cannot Open Messages", "No SMS app is available on this device.");
    });
  };


  const handleUpdateStatus = async (order: RentalOrder, newStatus: OrderStatus) => {
    // Re-entry guard: ignore a second tap while this order's transition is in flight
    // (the button also disables, but the network round-trip has real latency).
    if (processingOrderId === order.id) return;
    setProcessingOrderId(order.id);

    const updateData: Record<string, any> = {
      status: newStatus,
      updatedAt: new Date().toISOString(),
    };
    // When accepting a directly-assigned order, stamp provider identity. A BUY skips
    // document review and is accepted straight to Ready for Delivery, so stamp identity
    // for that target too — both are "accept from the request feed".
    if (
      order.status === OrderStatus.REQUESTED &&
      (newStatus === OrderStatus.CONFIRMED || newStatus === OrderStatus.READY_FOR_DELIVERY) &&
      providerProfile
    ) {
      updateData.providerName = providerProfile.businessName;
      updateData.providerPhone = providerProfile.phoneNumber;
      updateData.providerId = providerProfile.id;
    }
    // Stamp when the order first became ready for delivery. A buy reaches this straight
    // from Accept (no document gate); a rent reaches it once documents are verified.
    if (newStatus === OrderStatus.READY_FOR_DELIVERY && !order.readyForDeliveryAt) {
      updateData.readyForDeliveryAt = new Date().toISOString();
    }
    // Stamp completion once, when the order reaches a terminal done state, so
    // Logistics can bucket it under Completed and report when it finished.
    if ((newStatus === OrderStatus.DELIVERED || newStatus === OrderStatus.COMPLETED) && !order.completedAt) {
      updateData.completedAt = new Date().toISOString();
    }

    // Advance the card immediately; the provider-mirror hop reconciles it (or the
    // catch below rolls it back on failure).
    applyOptimistic(order.id, updateData);
    try {
      await db.collection('orders').doc(order.id).update(updateData);
    } catch (error: any) {
      clearOptimistic(order.id); // roll back the optimistic advance
      Alert.alert("Status Update Failed", error.message || "Could not sync status change.");
    } finally {
      if (mountedRef.current) setProcessingOrderId(null);
    }
  };


  const handleSendLocationUpdate = async (order: RentalOrder, status: string) => {
    // Re-entry guard mirrors handleUpdateStatus — Start Pickup/Delivery etc. also
    // disable while their round-trip is in flight.
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
      await updateLocationCall({
        orderId: order.id,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        providerCurrentStatus: status,
      });
      if (!coords) warnLocationUnavailableOnce();
    } catch (error: any) {
      clearOptimistic(order.id); // roll back the optimistic advance
      Alert.alert("Location Error", error.message);
    } finally {
      if (mountedRef.current) setProcessingOrderId(null);
    }
  };

  const getStatusLabel = (status: string, _isPickup: boolean): string => {
    const map: Record<string, string> = {
      requested: 'Requested',
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

  // Foodyzz owns the fleet, so this is the rental total, not a provider cut.
  const getPayout = (order: any) =>
    Number(order.chargedAmount ?? order.estimatedPrice ?? 0).toFixed(2);

  if (loading) {
    return (
      <View className="flex-1 bg-white justify-center items-center">
        <ActivityIndicator color={COLORS.brand.green} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Header Area */}
      <View className="bg-slate-900 px-4 pb-6 border-b-4 border-black mb-6 shadow-sm" style={{ paddingTop: top + 16 }}>
        <View className="flex-row justify-between items-end mb-4">
          <View>
            <Text className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1">
              Operational Dispatch
            </Text>
            <Text className="text-2xl font-black text-white uppercase tracking-tighter">
              Order<Text className="text-brand-green">.Stream</Text>
            </Text>
          </View>
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={() => (navigation as any).navigate('Account')}
              className="p-2 bg-slate-950 border-2 border-slate-700 rounded-xl"
            >
              <User size={14} color="#94a3b8" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setKeepAwake((v) => !v)}
              activeOpacity={0.8}
              className={`flex-row items-center gap-1.5 px-3 py-1.5 rounded-xl border-2 ${keepAwake ? 'bg-[#86B54F] border-black' : 'bg-slate-950 border-slate-700'}`}
            >
              <Sun size={12} color={keepAwake ? '#000000' : '#94a3b8'} fill={keepAwake ? '#000000' : 'none'} />
              <Text className={`font-mono font-black text-[9px] uppercase ${keepAwake ? 'text-black' : 'text-slate-400'}`}>
                {keepAwake ? 'Awake' : 'Stay On'}
              </Text>
            </TouchableOpacity>
            <View className="bg-[#86B54F] px-3 py-1 rounded-xl border-2 border-black">
              <Text className="text-black font-mono font-black text-[10px] uppercase">
                {visibleOrders.length} Open
              </Text>
            </View>
          </View>
        </View>

        {isBlocked ? (
          <View className="bg-rose-500/10 p-3 rounded-2xl border border-rose-500/40 flex-row items-center gap-3">
            <Power size={16} color="#f43f5e" />
            <Text className="text-[9px] text-rose-400 font-bold uppercase leading-relaxed flex-1">
              Account suspended by admin. You won't receive any orders. Contact support to restore access.
            </Text>
          </View>
        ) : servicesActive ? (
          <View className="bg-slate-950 p-3 rounded-2xl border border-black flex-row items-center gap-3">
            <Zap size={16} color="#86B54F" fill="#86B54F" />
            <Text className="text-[9px] text-slate-400 font-bold uppercase leading-relaxed flex-1">
              Real-time feed active. New rental requests land here the moment a customer submits.
            </Text>
          </View>
        ) : (
          <View className="bg-amber-500/10 p-3 rounded-2xl border border-amber-500/40 flex-row items-center gap-3">
            <Power size={16} color="#f59e0b" />
            <Text className="text-[9px] text-amber-400 font-bold uppercase leading-relaxed flex-1">
              Services paused. Customers can't pick your location — re-enable in Account to go live.
            </Text>
          </View>
        )}
      </View>

      <FlatList
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 128 }}
        showsVerticalScrollIndicator={false}
        data={visibleOrders}
        keyExtractor={(item) => item.id}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={11}
        ListEmptyComponent={(
          <View className="p-10 mt-10 items-center opacity-40">
            <Building size={48} color="#475569" />
            <Text className="text-slate-500 font-bold text-xs uppercase mt-4 text-center">
              No pending rental requests.
            </Text>
          </View>
        )}
        renderItem={({ item: order }) => {
            const currentProviderId = providerProfile?.id;
            const isMine = order.providerId === currentProviderId;
            // Every bike rental is delivered to the customer; the drop-off variant
            // the bike flow had does not exist here.
            const isPickupOrder = true;
            // A status transition for THIS order is in flight — disable its action
            // buttons so the notification/network lag can't turn a double-tap into a
            // double status write.
            const busy = processingOrderId === order.id;
            // Stamped by CustomerIdCard once BOTH documents are verified.
            const docsVerified = !!order.docsVerifiedAt;

            return (
              <View
                key={order.id}
                style={{ backgroundColor: isPickupOrder ? '#f0fdf4' : '#ffffff' }}
                className="border-2 border-black rounded-[32px] p-5 mb-4 shadow-brutalist"
              >
                <View className="flex-row justify-between items-start mb-4 pb-3 border-b border-slate-100">
                  <View className="flex-1 mr-3">
                    <View className="flex-row items-center flex-wrap gap-1.5 mb-1.5">
                      <View className="bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200">
                        <Text className="text-slate-500 font-mono text-[8px] font-black">{order.id.replace('order_', '#').toUpperCase()}</Text>
                      </View>
                      <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded border bg-green-50 border-green-200">
                        <Truck size={9} color="#16a34a" />
                        <Text className="text-green-700 font-black text-[7px] uppercase">Delivery</Text>
                      </View>
                      <View className="flex-row items-center gap-1 px-1.5 py-0.5 rounded border bg-indigo-50 border-indigo-200">
                        <Bike size={9} color="#507425" />
                        <Text className="text-indigo-700 font-black text-[7px] uppercase">
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
                  </View>
                </View>

                <View className="space-y-3 mb-5">
                  {isPickupOrder && (
                    <View className="flex-row items-start gap-2.5">
                      <MapPin size={14} color="#507425" className="mt-0.5" />
                      <View>
                        <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">Delivery Address</Text>
                        <Text className="text-slate-700 text-[10px] font-bold leading-snug">
                          {order.customerAddress}
                        </Text>
                      </View>
                    </View>
                  )}
                  <View className="flex-row items-start gap-2.5">
                    <Clock size={14} color="#507425" className="mt-0.5" />
                    <View className="flex-1">
                      <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">Rental Detail</Text>
                      {(() => {
                        const modelLabel = order.bikeModel ? `MODEL ${order.bikeModel}` : 'BIKE';
                        const typeLabel = order.rentalType === 'rentToBuy'
                          ? 'RENT TO BUY'
                          : order.rentalType === 'buy' ? 'BUY' : 'RENT';
                        const term = order.durationValue
                          ? `${order.durationValue} ${String(order.durationUnit || '').toUpperCase()}`
                          : null;
                        // Fees the customer actually accepted — the ones opted out of are
                        // filtered so the card reflects what will be billed. The deposit is
                        // listed separately because it is never on the rental invoice.
                        const acceptedFees = (order.fees || []).filter((f: any) => f.accepted && f.key !== 'deposit');
                        return (
                          <>
                            <Text className="text-black text-[10px] font-black uppercase">
                              {modelLabel} • {typeLabel}{term ? ` • ${term}` : ''}
                            </Text>
                            <View className="mt-1.5">
                              <View className="flex-row items-baseline gap-1.5">
                                <Text className="text-slate-500 text-[8px] font-black uppercase tracking-wide">Deliver</Text>
                                <Text className="text-black text-[10px] font-black uppercase">
                                  {order.startDate || '—'}{order.deliveryTime ? ` · ${order.deliveryTime}` : ''}
                                </Text>
                              </View>
                              {order.expectedEndDate && (
                                <View className="flex-row items-baseline gap-1.5">
                                  <Text className="text-slate-500 text-[8px] font-black uppercase tracking-wide">Due back</Text>
                                  <Text className="text-black text-[10px] font-black uppercase">{order.expectedEndDate}</Text>
                                </View>
                              )}
                              {order.deliveryTimeConfirmedAt && (
                                <Text className="text-emerald-600 text-[8px] font-black uppercase tracking-wide mt-0.5">
                                  Delivery time confirmed
                                </Text>
                              )}
                            </View>
                            {acceptedFees.length > 0 && (
                              <View className="mt-1.5 flex-row flex-wrap gap-1">
                                {acceptedFees.map((f: any) => (
                                  <View key={f.key} className="bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                                    <Text className="text-slate-600 font-black text-[8px] uppercase">
                                      {f.label} ${Number(f.amount).toFixed(2)}
                                    </Text>
                                  </View>
                                ))}
                              </View>
                            )}
                            {order.depositAmount > 0 && (
                              <Text className="text-slate-400 text-[8px] font-black uppercase tracking-wide mt-1">
                                Deposit ${Number(order.depositAmount).toFixed(2)} · secured separately, not invoiced
                              </Text>
                            )}
                            {!!order.notes && order.notes.trim() !== '' && (
                              <View className="mt-1.5 bg-amber-50 border border-amber-200 self-start max-w-full px-2 py-1 rounded-lg">
                                <Text className="text-amber-700 text-[8px] font-black uppercase tracking-wide mb-0.5">Customer Notes</Text>
                                <Text className="text-slate-800 text-[10px] font-bold leading-snug">{order.notes.trim()}</Text>
                              </View>
                            )}
                          </>
                        );
                      })()}
                    </View>
                  </View>
                  {/* Accepted RENTALS move on to ID / address-proof review. A repeat
                      customer with documents already on file skips the request. A BUY is
                      a purchase — no documents are collected, so this card is skipped and
                      the order goes straight to Ready for Delivery on Accept. */}
                  {order.status !== OrderStatus.REQUESTED && order.rentalType !== 'buy' && (
                    <CustomerIdCard
                      order={order}
                      onMessage={() => (navigation as any).navigate('Chat', { orderId: order.id })}
                    />
                  )}
                  {/* Provider-private notes — only the provider sees these. */}
                  <ProviderNotes orderId={order.id} />
                </View>

                {isMine ? (
                  <View className="space-y-2">
                    <View className="flex-row gap-2">
                      {order.status === OrderStatus.REQUESTED && (
                        <TouchableOpacity
                          onPress={() => handleUpdateStatus(order, order.rentalType === 'buy' ? OrderStatus.READY_FOR_DELIVERY : OrderStatus.CONFIRMED)}
                          disabled={busy}
                          activeOpacity={busy ? 1 : 0.8}
                          className={`flex-1 py-3.5 rounded-2xl items-center flex-row justify-center gap-2 ${busy ? 'bg-slate-200' : 'bg-[#86B54F]'}`}
                        >
                          {busy ? (
                            <ActivityIndicator size="small" color="black" />
                          ) : (
                            <View className="flex-row items-center gap-2">
                              <CheckCircle size={14} color="black" />
                              <Text className="text-black font-black uppercase text-[10px] tracking-widest">Accept Order</Text>
                            </View>
                          )}
                        </TouchableOpacity>
                      )}
                      {order.status === OrderStatus.CONFIRMED && (
                        docsVerified ? (
                          <TouchableOpacity
                            onPress={() => handleUpdateStatus(order, OrderStatus.READY_FOR_DELIVERY)}
                            disabled={busy}
                            activeOpacity={busy ? 1 : 0.8}
                            style={{ opacity: busy ? 0.6 : 1 }}
                            className="flex-1 bg-[#86B54F] py-3.5 rounded-2xl items-center flex-row justify-center gap-2"
                          >
                            <Truck size={14} color="black" />
                            <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                              Ready for Delivery
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          // Hard gate: a bike never leaves before ID and proof of
                          // address are verified on the card above.
                          <View className="flex-1 bg-slate-100 py-3.5 rounded-2xl items-center flex-row justify-center gap-2 border border-slate-200">
                            <Clock size={14} color="#94a3b8" />
                            <Text className="text-slate-400 font-black uppercase text-[10px] tracking-widest">
                              Verify documents first
                            </Text>
                          </View>
                        )
                      )}
                      {order.status === OrderStatus.READY_FOR_DELIVERY && (
                        <View className="flex-1 bg-emerald-50 py-3.5 rounded-2xl items-center flex-row justify-center gap-2 border border-emerald-200">
                          <CheckCircle size={14} color="#059669" />
                          <Text className="text-emerald-700 font-black uppercase text-[10px] tracking-widest">
                            In Operations
                          </Text>
                        </View>
                      )}
                    </View>
                    
                    {![OrderStatus.DELIVERED, OrderStatus.COMPLETED, OrderStatus.EN_ROUTE_DELIVERY, OrderStatus.AT_DELIVERY, OrderStatus.DELIVERED].includes(order.status as OrderStatus) && (
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
                ) : null}
              </View>
            );
          }}
        />

      {/* Live fleet inventory — floats just above the bottom tab bar. Purely
          informational (pointerEvents none), so it never blocks the feed's scroll.
          Counts are fleet-wide `available` bikes, split by model and condition, and
          update in real time as bikes are reserved, delivered, sold or returned. */}
      {inventory.length > 0 && (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: 16, right: 16, bottom: 12 }}
        >
          <View className="bg-slate-900 border-2 border-black rounded-2xl px-4 py-2.5 shadow-brutalist">
            <Text className="text-[8px] font-mono font-black text-slate-400 uppercase tracking-widest mb-1.5">
              Current Inventory
            </Text>
            {inventory.map((m) => (
              <View key={m.model} className="flex-row items-center justify-between py-0.5">
                <Text className="text-white font-black text-[10px] uppercase tracking-wide">
                  Model {m.model}
                </Text>
                <View className="flex-row items-center gap-3">
                  <Text className="text-brand-green font-black text-[10px] uppercase">
                    New <Text className="text-white">({m.new})</Text>
                  </Text>
                  <Text className="text-slate-300 font-black text-[10px] uppercase">
                    Used <Text className="text-white">({m.used})</Text>
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}