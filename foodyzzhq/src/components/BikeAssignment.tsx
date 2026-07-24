// Bike-number assignment on an Operations delivery card.
//
// A rental detail names a bike MODEL; before a bike can go out, staff pick the exact
// physical bike NUMBER from the model's available stock. That choice reserves the bike
// (server-side, via assignBikeToOrder — inventory writes are admin/server-only) and
// stamps its number onto the order for the life of the transaction.
//
//   - Ready for Delivery, no bike yet → a required "Select bike number" dropdown; the
//     Start Delivery button stays disabled until one is chosen.
//   - Ready for Delivery, bike chosen → shows the number with a "Change" option (staff
//     can swap to another available bike right up until the rider sets off).
//   - Delivery started / delivered / completed → the number shows read-only.
import React, { useEffect, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, FlatList, ActivityIndicator, Alert,
} from 'react-native';
import { Bike as BikeIcon, Check, ChevronDown, X } from 'lucide-react-native';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { db } from '../services/firebase';
import { allowedConditions } from '../services/logistics';
import { OrderStatus } from '../types';

interface Props {
  order: any;
  // Patch the local order the instant a bike is assigned, so the number appears and
  // Start Delivery unlocks without waiting for the provider-mirror round-trip.
  onAssigned?: (orderId: string, patch: Record<string, any>) => void;
}

export default function BikeAssignment({ order, onAssigned }: Props) {
  const hasBike = order.bikeId != null && order.bikeId !== '';
  // The number is locked in once the rider has set off; only Ready-for-Delivery is editable.
  const editable = order.status === OrderStatus.READY_FOR_DELIVERY;

  const [available, setAvailable] = useState<any[]>([]);
  const [loadingBikes, setLoadingBikes] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const conditions = useMemo(
    () => allowedConditions((order.rentalType as any) || 'rent'),
    [order.rentalType],
  );

  // Live list of free bikes for this model — only needed while the order is still
  // editable (Ready for Delivery). A bike reserved elsewhere drops out in real time.
  //
  // Gated on pickerOpen (option a): several Ready-for-Delivery cards can be visible at
  // once, and each used to hold its own bikes-by-model onSnapshot the whole time —
  // N overlapping listeners over largely the same data. We now subscribe only while
  // THIS card's picker modal is actually open, so an idle card holds no listener. The
  // fresh list is fetched on open (cheap) and torn down on close; assignment/cleanup
  // are otherwise identical.
  useEffect(() => {
    if (!editable || !pickerOpen || order.bikeModel == null) return;
    setLoadingBikes(true);
    const unsub = db.collection('bikes')
      .where('model', '==', order.bikeModel)
      .onSnapshot(
        (snap: any) => {
          const rows = snap.docs
            .map((d: any) => ({ id: d.id, ...d.data() }))
            .filter((b: any) => b.status === 'available' && conditions.includes(b.condition))
            .sort((a: any, b: any) => (a.bikeNo ?? 0) - (b.bikeNo ?? 0));
          setAvailable(rows);
          setLoadingBikes(false);
        },
        (e: any) => { console.warn('BikeAssignment: bikes listener failed', e); setLoadingBikes(false); },
      );
    return () => unsub();
  }, [editable, pickerOpen, order.bikeModel, conditions]);

  const assign = async (bike: any) => {
    if (savingId) return;
    setSavingId(bike.id);
    try {
      const call = firebase.app().functions('us-central1').httpsCallable('assignBikeToOrder');
      await call({ orderId: order.id, bikeId: bike.id });
      onAssigned?.(order.id, {
        bikeId: bike.id,
        bikeNo: bike.bikeNo ?? null,
        bikeCondition: bike.condition ?? null,
      });
      setPickerOpen(false);
    } catch (e: any) {
      Alert.alert('Could not assign bike', e?.message || 'Please try again.');
    } finally {
      setSavingId(null);
    }
  };

  // Nothing to show for an unassigned order that can't be assigned here.
  if (!hasBike && !editable) return null;

  return (
    <View className="flex-row items-start gap-2.5">
      <BikeIcon size={14} color="#507425" />
      <View className="flex-1">
        <Text className="text-slate-500 text-[8px] font-black uppercase mb-0.5">Assigned Bike</Text>

        {hasBike ? (
          <View className="flex-row items-center gap-2">
            <View className="flex-row items-center gap-1 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg self-start">
              <Check size={11} color="#059669" />
              <Text className="text-emerald-700 font-black text-[11px] uppercase">
                #{order.bikeNo}
                {order.bikeCondition ? ` · ${String(order.bikeCondition)}` : ''}
              </Text>
            </View>
            {editable && (
              <TouchableOpacity onPress={() => setPickerOpen(true)} disabled={!!savingId}>
                <Text className="text-indigo-600 font-black text-[9px] uppercase tracking-widest">Change</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setPickerOpen(true)}
            className="flex-row items-center justify-between bg-amber-50 border border-amber-300 rounded-xl px-3 py-2.5 self-start"
          >
            <Text className="text-amber-800 font-black text-[10px] uppercase tracking-widest mr-2">
              Select bike number
            </Text>
            <ChevronDown size={14} color="#b45309" />
          </TouchableOpacity>
        )}
        {!hasBike && (
          <Text className="text-slate-400 text-[8px] font-bold uppercase tracking-wide mt-1">
            Required before delivery can start
          </Text>
        )}
      </View>

      {/* Picker — available numbers for this model / condition. */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View className="flex-1 bg-black/60 justify-end">
          <View className="bg-white rounded-t-[32px] border-t-4 border-black max-h-[70%] pb-8">
            <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
              <View>
                <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                  Model {order.bikeModel} · available
                </Text>
                <Text className="text-lg font-black uppercase tracking-tighter">Pick a bike number</Text>
              </View>
              <TouchableOpacity onPress={() => setPickerOpen(false)} className="p-2">
                <X size={22} color="#0f172a" />
              </TouchableOpacity>
            </View>

            {loadingBikes ? (
              <View className="py-12 items-center">
                <ActivityIndicator color="#507425" />
              </View>
            ) : available.length === 0 ? (
              <View className="py-12 px-8 items-center">
                <BikeIcon size={36} color="#cbd5e1" />
                <Text className="text-slate-400 font-black text-[11px] uppercase tracking-widest mt-3 text-center">
                  No available Model {order.bikeModel} bikes
                </Text>
                <Text className="text-slate-400 text-[10px] font-bold mt-1 text-center">
                  Every bike of this model is out or in maintenance. Free one up in the fleet, then try again.
                </Text>
              </View>
            ) : (
              <FlatList
                data={available}
                keyExtractor={(b) => b.id}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
                renderItem={({ item }) => {
                  const isCurrent = order.bikeId === item.id;
                  const saving = savingId === item.id;
                  return (
                    <TouchableOpacity
                      onPress={() => assign(item)}
                      disabled={!!savingId}
                      style={{ opacity: savingId && !saving ? 0.5 : 1 }}
                      className={`flex-row items-center justify-between px-4 py-3.5 rounded-2xl border-2 mb-2 ${
                        isCurrent ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-slate-200'
                      }`}
                    >
                      <View className="flex-row items-center gap-3">
                        <View className="w-9 h-9 rounded-full bg-slate-100 items-center justify-center">
                          <BikeIcon size={16} color="#507425" />
                        </View>
                        <View>
                          <Text className="text-black font-black text-sm uppercase tracking-tight">#{item.bikeNo}</Text>
                          <Text className="text-slate-400 font-black text-[8px] uppercase tracking-widest">
                            {item.condition}
                          </Text>
                        </View>
                      </View>
                      {saving ? (
                        <ActivityIndicator size="small" color="#507425" />
                      ) : isCurrent ? (
                        <Check size={18} color="#059669" />
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
