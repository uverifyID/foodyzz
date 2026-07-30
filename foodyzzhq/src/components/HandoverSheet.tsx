// Bike handover — the last step before a rental starts running.
//
// Staff inspect the bike WITH the customer present and record its condition:
// free-text notes plus photos. Both are stored on the order (photos in Storage under
// bikeCondition/{orderId}/) so each side holds the same record if there is a dispute
// about damage when the bike comes back.
//
// Confirming (deliver) calls markRentalDelivered, which is the single place that:
//   1. captures the authorized rental charge,
//   2. charges the security deposit as a separate transaction,
//   3. writes this condition report and flips the order to DELIVERED.
// Confirming (return) calls markRentalReturned, which completes the rental, applies any
// damage adjustments the provider added, and refunds the deposit balance to the customer.
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, Image, ScrollView, Modal,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import storage from '@react-native-firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, X, Trash2, Package, ClipboardCheck, Plus } from 'lucide-react-native';
import firebase from '@react-native-firebase/app';

interface Props {
  order: any | null;
  // 'deliver' captures condition at handover and starts the rental;
  // 'return' captures it on the way back in and completes the rental.
  mode?: 'deliver' | 'return';
  onClose: () => void;
  onDelivered?: () => void;
}

const MAX_PHOTOS = 6;

export default function HandoverSheet({ order, mode = 'deliver', onClose, onDelivered }: Props) {
  // A Modal covers the whole window including the nav bar, so the sheet's action
  // row carries its own bottom inset — it is the last thing above the nav bar.
  const { bottom } = useSafeAreaInsets();
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // Damage/condition adjustments (return only): each is subtracted from the deposit
  // before the balance is refunded. Amounts are kept as strings while editing.
  const [adjustments, setAdjustments] = useState<{ note: string; amount: string }[]>([]);

  // The sheet stays mounted across opens (it just renders null when order is null), so
  // clear per-rental state whenever the order changes to avoid carrying over notes,
  // photos, or — critically — a previous rental's damage adjustments.
  useEffect(() => {
    setNotes('');
    setPhotos([]);
    setAdjustments([]);
  }, [order?.id]);

  // On return, we show the record captured at handover as a reference to compare against.
  // Photos are stored as Storage paths, so resolve them to download URLs for display.
  const [handoverUrls, setHandoverUrls] = useState<string[]>([]);
  const [loadingHandover, setLoadingHandover] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handoverPaths: string[] = order?.conditionAtDelivery?.photoPaths ?? [];

  useEffect(() => {
    if (mode !== 'return' || handoverPaths.length === 0) {
      setHandoverUrls([]);
      return;
    }
    let cancelled = false;
    setLoadingHandover(true);
    Promise.all(
      handoverPaths.map((p) => storage().ref(p).getDownloadURL().catch(() => null)),
    ).then((urls) => {
      if (cancelled) return;
      setHandoverUrls(urls.filter(Boolean) as string[]);
      setLoadingHandover(false);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, mode]);

  if (!order) return null;

  const deposit = Number(order.depositAmount ?? 0);
  const charge = Number(order.chargedAmount ?? order.estimatedPrice ?? 0);

  // Live refund preview from the adjustments the provider has entered. Capped at the
  // deposit — we only ever hold back what was collected.
  const adjustmentTotal = adjustments.reduce((s, a) => s + Math.max(0, parseFloat(a.amount) || 0), 0);
  const cappedAdjustment = Math.min(adjustmentTotal, deposit);
  const refundPreview = Math.round(Math.max(0, deposit - cappedAdjustment) * 100) / 100;

  const addAdjustment = () => setAdjustments((prev) => [...prev, { note: '', amount: '' }]);
  const updateAdjustment = (i: number, field: 'note' | 'amount', val: string) =>
    setAdjustments((prev) => prev.map((a, idx) => (idx === i ? { ...a, [field]: val } : a)));
  const removeAdjustment = (i: number) =>
    setAdjustments((prev) => prev.filter((_, idx) => idx !== i));

  // The condition report recorded when the bike was handed over (return mode only).
  const handover = order.conditionAtDelivery as
    | { notes?: string; photoPaths?: string[]; recordedAt?: string }
    | undefined;
  const handoverDate = handover?.recordedAt
    ? new Date(handover.recordedAt).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null;

  const takeOrPick = async (source: 'camera' | 'library') => {
    try {
      const perm =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          source === 'camera' ? 'Camera needed' : 'Photos needed',
          `Allow ${source === 'camera' ? 'camera' : 'photo library'} access to add a photo.`,
        );
        return;
      }
      const res =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.6 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (res.canceled || !res.assets?.length) return;
      setPhotos((prev) => [...prev, res.assets[0].uri]);
    } catch (e: any) {
      // The simulator has no camera, so launchCameraAsync throws there — surface it
      // rather than the button appearing to do nothing.
      Alert.alert('Could not add photo', e?.message || 'Please try the photo library instead.');
    }
  };

  // Offer both, since the camera is unavailable on the simulator and staff sometimes
  // photograph the bike separately first.
  const addPhoto = () => {
    if (photos.length >= MAX_PHOTOS) return;
    Alert.alert('Add a photo', undefined, [
      { text: 'Take photo', onPress: () => takeOrPick('camera') },
      { text: 'Choose from library', onPress: () => takeOrPick('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const confirm = async () => {
    setSaving(true);
    try {
      // Upload first so a failed upload doesn't leave a charged order without its
      // condition record.
      const paths: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const path = `bikeCondition/${order.id}/${Date.now()}_${i}.jpg`;
        await storage().ref(path).putFile(photos[i], { contentType: 'image/jpeg' });
        paths.push(path);
      }

      const isReturn = mode === 'return';
      // Clean adjustments: trimmed note + positive numeric amount only.
      const cleanAdjustments = adjustments
        .map((a) => ({ note: a.note.trim(), amount: Math.max(0, parseFloat(a.amount) || 0) }))
        .filter((a) => a.amount > 0);
      const call = firebase.app().functions()
        .httpsCallable(isReturn ? 'markRentalReturned' : 'markRentalDelivered');
      const res: any = await call({
        orderId: order.id,
        ...(isReturn
          ? { returnNotes: notes.trim(), returnPhotoPaths: paths, adjustments: cleanAdjustments }
          : { conditionNotes: notes.trim(), conditionPhotoPaths: paths }),
      });

      if (isReturn) {
        const refunded = typeof res?.data?.depositRefunded === 'number' ? res.data.depositRefunded : refundPreview;
        const adjTotal = typeof res?.data?.depositAdjustmentTotal === 'number' ? res.data.depositAdjustmentTotal : cappedAdjustment;
        let msg = 'Bike checked back in.';
        if (res?.data?.depositError) {
          msg = `Bike checked back in, but the $${refundPreview.toFixed(2)} deposit refund did not go through: ${res.data.depositError}. Follow up with the customer.`;
        } else if (deposit > 0) {
          msg = adjTotal > 0
            ? `Bike checked back in. $${adjTotal.toFixed(2)} in adjustments applied — $${refunded.toFixed(2)} of the $${deposit.toFixed(2)} deposit refunded to the customer.`
            : `Bike checked back in. The full $${deposit.toFixed(2)} deposit was refunded to the customer.`;
        }
        Alert.alert('Rental completed', msg);
        onDelivered?.();
        onClose();
        return;
      }

      // The deposit charge is best-effort inside the callable — surface it rather than
      // letting staff assume it succeeded.
      if (res?.data?.depositError) {
        Alert.alert(
          'Delivered — deposit not charged',
          `The rental was charged, but the $${deposit.toFixed(2)} deposit could not be charged: ` +
          `${res.data.depositError}. Follow up with the customer.`,
        );
      }
      onDelivered?.();
      onClose();
    } catch (e: any) {
      Alert.alert('Could not complete delivery', e?.message || 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1 justify-end bg-black/60"
      >
        <View className="bg-white rounded-t-[32px] border-t-4 border-black max-h-[88%]">
          <View className="flex-row items-center justify-between px-5 pt-5 pb-3">
            <Text className="text-lg font-black uppercase tracking-tighter">{mode === 'return' ? 'Bike return' : 'Bike handover'}</Text>
            <TouchableOpacity onPress={onClose} className="p-2">
              <X size={22} color="#0f172a" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-5" keyboardShouldPersistTaps="handled">
            <Text className="text-[11px] font-bold text-slate-500 mb-4">
              {mode === 'return'
                ? 'Check the bike back in with the customer. Compare against the handover record — note any damage and add an adjustment to deduct it from the deposit refund.'
                : 'Check the bike over with the customer. Anything you record here is the shared reference if there is a question about its condition on return.'}
            </Text>

            {mode === 'return' && (
              <View className="bg-slate-50 border-2 border-slate-200 rounded-2xl p-4 mb-5">
                <View className="flex-row items-center justify-between mb-2">
                  <View className="flex-row items-center">
                    <ClipboardCheck size={13} color="#64748b" />
                    <Text className="ml-1.5 text-[9px] font-black text-slate-500 uppercase tracking-widest">
                      Handover record
                    </Text>
                  </View>
                  {handoverDate && (
                    <Text className="text-[10px] font-bold text-slate-400">{handoverDate}</Text>
                  )}
                </View>

                {handover ? (
                  <>
                    {handover.notes ? (
                      <Text className="text-[13px] text-slate-700 leading-5">{handover.notes}</Text>
                    ) : (
                      <Text className="text-[13px] italic text-slate-400">
                        No condition notes were recorded at handover.
                      </Text>
                    )}

                    {loadingHandover ? (
                      <View className="flex-row items-center mt-3">
                        <ActivityIndicator size="small" color="#94a3b8" />
                        <Text className="ml-2 text-[11px] font-bold text-slate-400">
                          Loading handover photos…
                        </Text>
                      </View>
                    ) : handoverUrls.length > 0 ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        className="mt-3 -mx-1"
                        contentContainerStyle={{ paddingHorizontal: 4 }}
                      >
                        {handoverUrls.map((uri) => (
                          <TouchableOpacity
                            key={uri}
                            onPress={() => setPreview(uri)}
                            className="mr-2"
                            activeOpacity={0.8}
                          >
                            <Image
                              source={{ uri }}
                              className="w-24 h-24 rounded-xl border border-slate-200"
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    ) : handoverPaths.length === 0 ? (
                      <Text className="text-[11px] font-bold text-slate-400 mt-2">
                        No photos were taken at handover.
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text className="text-[13px] italic text-slate-400">
                    No handover record is on file for this rental.
                  </Text>
                )}
              </View>
            )}

            <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">
              {mode === 'return' ? 'Return notes' : 'Condition notes'}
            </Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              multiline
              placeholder="Scratches, tyre wear, accessories handed over, anything the customer pointed out…"
              placeholderTextColor="#94a3b8"
              className="border-2 border-slate-200 rounded-2xl px-3 py-3 text-sm text-black mb-4"
              style={{ minHeight: 88, textAlignVertical: 'top' }}
            />

            <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
              Photos ({photos.length}/{MAX_PHOTOS})
            </Text>
            <View className="flex-row flex-wrap mb-4">
              {photos.map((uri, i) => (
                <View key={uri} className="w-[31%] mr-[2%] mb-2">
                  <Image source={{ uri }} className="w-full h-20 rounded-xl" resizeMode="cover" />
                  <TouchableOpacity
                    onPress={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                    className="absolute top-1 right-1 bg-black/70 rounded-full p-1"
                  >
                    <Trash2 size={11} color="#ffffff" />
                  </TouchableOpacity>
                </View>
              ))}
              {photos.length < MAX_PHOTOS && (
                <TouchableOpacity
                  onPress={addPhoto}
                  className="w-[31%] h-20 rounded-xl border-2 border-dashed border-slate-300 items-center justify-center"
                >
                  <Camera size={18} color="#94a3b8" />
                </TouchableOpacity>
              )}
            </View>

            <View className="border-2 border-black rounded-2xl p-4 mb-4">
              <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">
                On confirming
              </Text>

              {mode === 'return' ? (
                <>
                  <Text className="text-[11px] font-bold text-slate-500 mb-3">
                    The rental is marked complete and the bike returns to available stock.
                    {deposit > 0
                      ? ` The remaining deposit is refunded to the customer${adjustmentTotal > 0 ? ', after the adjustments below' : ''}.`
                      : ''}
                  </Text>

                  {deposit > 0 && (
                    <>
                      <View className="flex-row justify-between mb-2">
                        <Text className="text-xs font-bold text-slate-600">Deposit held</Text>
                        <Text className="text-xs font-black text-black">${deposit.toFixed(2)}</Text>
                      </View>

                      {/* Damage adjustments — each note + amount is subtracted from the deposit. */}
                      {adjustments.map((adj, i) => (
                        <View key={i} className="flex-row items-center mb-2">
                          <TextInput
                            value={adj.note}
                            onChangeText={(t) => updateAdjustment(i, 'note', t)}
                            placeholder="Reason (e.g. scratched fender)"
                            placeholderTextColor="#94a3b8"
                            className="flex-1 border border-slate-200 rounded-xl px-2.5 py-2 text-[12px] text-black mr-2"
                          />
                          <View className="flex-row items-center border border-slate-200 rounded-xl px-2 py-2 mr-1">
                            <Text className="text-[12px] font-bold text-slate-400">$</Text>
                            <TextInput
                              value={adj.amount}
                              onChangeText={(t) => updateAdjustment(i, 'amount', t.replace(/[^0-9.]/g, ''))}
                              placeholder="0.00"
                              placeholderTextColor="#94a3b8"
                              keyboardType="decimal-pad"
                              className="w-14 text-[12px] font-black text-black"
                            />
                          </View>
                          <TouchableOpacity onPress={() => removeAdjustment(i)} className="p-1.5">
                            <Trash2 size={14} color="#e11d48" />
                          </TouchableOpacity>
                        </View>
                      ))}

                      <TouchableOpacity
                        onPress={addAdjustment}
                        className="flex-row items-center self-start bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 mb-1 mt-0.5"
                      >
                        <Plus size={13} color="#475569" />
                        <Text className="ml-1.5 text-[11px] font-black text-slate-600 uppercase tracking-wide">Add adjustment</Text>
                      </TouchableOpacity>

                      {cappedAdjustment > 0 && (
                        <View className="flex-row justify-between mt-2">
                          <Text className="text-xs font-bold text-rose-600">Adjustments</Text>
                          <Text className="text-xs font-black text-rose-600">−${cappedAdjustment.toFixed(2)}</Text>
                        </View>
                      )}
                      <View className="flex-row justify-between mt-2 pt-2 border-t border-slate-200">
                        <Text className="text-xs font-black text-slate-800 uppercase">Refund to customer</Text>
                        <Text className="text-sm font-black text-brand-green-dark">${refundPreview.toFixed(2)}</Text>
                      </View>
                    </>
                  )}
                </>
              ) : (
                <>
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-xs font-bold text-slate-600">Rental charged</Text>
                    <Text className="text-xs font-black text-black">${charge.toFixed(2)}</Text>
                  </View>
                  {deposit > 0 && (
                    <View className="flex-row justify-between">
                      <Text className="text-xs font-bold text-slate-600">Deposit charged</Text>
                      <Text className="text-xs font-black text-black">${deposit.toFixed(2)}</Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </ScrollView>

          <View className="px-5 pt-3 border-t border-slate-100" style={{ paddingBottom: bottom + 32 }}>
            <TouchableOpacity
              onPress={confirm}
              disabled={saving}
              style={{ opacity: saving ? 0.6 : 1 }}
              className="bg-[#86B54F] py-4 rounded-2xl items-center flex-row justify-center border-2 border-black"
            >
              {saving ? (
                <ActivityIndicator color="black" />
              ) : (
                <View className="flex-row items-center">
                  <Package size={16} color="black" />
                  <Text className="ml-2 text-black font-black uppercase text-sm tracking-widest">
                    {mode === 'return' ? 'Confirm return' : 'Confirm delivery'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>

      {preview && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setPreview(null)}>
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setPreview(null)}
            className="flex-1 bg-black/90 items-center justify-center"
          >
            <Image source={{ uri: preview }} className="w-full h-2/3" resizeMode="contain" />
            <View className="absolute top-14 right-5 bg-white/20 rounded-full p-2">
              <X size={22} color="#ffffff" />
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </Modal>
  );
}
