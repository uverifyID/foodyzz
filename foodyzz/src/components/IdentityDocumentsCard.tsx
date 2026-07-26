// Identity documents — driver license (front + back) AND proof of address, captured
// and submitted TOGETHER. FoodyzzHQ verifies both before a bike is released, so the
// customer can't submit a partial set: the button stays disabled until all three
// images are present, and one save writes both records at once.
//
// Used in Account → Profile, and right after FoodyzzHQ accepts an order.
import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { CreditCard, FileText, CheckCircle, Clock, ShieldCheck, Lock, AlertTriangle } from 'lucide-react-native';
import {
  pickDocumentImage,
  uploadDocumentImage,
  saveDocumentToProfile,
  documentImageUrl,
} from '../services/customerDocuments';

interface Props {
  profile: any;
  subtitle?: string;
  onSaved?: () => void;
}

// The three images this card collects.
type Slot = 'licenseFront' | 'licenseBack' | 'address';
const SLOTS: { key: Slot; label: string }[] = [
  { key: 'licenseFront', label: 'License · Front' },
  { key: 'licenseBack', label: 'License · Back' },
  { key: 'address', label: 'Proof of address' },
];

export default function IdentityDocumentsCard({ profile, subtitle, onSaved }: Props) {
  const license = profile?.driverLicense;
  const address = profile?.addressProof;

  const [local, setLocal] = useState<Partial<Record<Slot, string>>>({});
  const [remote, setRemote] = useState<Partial<Record<Slot, string>>>({});
  const [busy, setBusy] = useState(false);
  // Verified documents are masked by default. This flips the card back into
  // capture mode so a customer can replace them (new licence, moved address).
  const [replacing, setReplacing] = useState(false);

  // Both documents present AND reviewed is the fully-verified state.
  const bothOnFile = !!license?.frontPath && !!license?.backPath && !!address?.frontPath;
  const verified = bothOnFile && !!license?.reviewedAt && !!address?.reviewedAt;
  const rejected = license?.rejectedReason || address?.rejectedReason;
  // Once FoodyzzHQ has verified them there's no reason to keep a customer's licence
  // and address proof rendered in their account — the card shows a sealed placeholder
  // and the verified badge instead. Uploading a replacement unmasks the tiles for
  // the new images only.
  const masked = verified && !replacing;

  useEffect(() => {
    let cancelled = false;
    // Never resolve download URLs for a VERIFIED customer — not just while masked.
    // Their stored images are sealed even mid-replacement (renderSlot shows only the
    // freshly picked one), so fetching them is three Storage round-trips whose
    // results can never be displayed.
    if (verified) { setRemote({}); return; }
    const paths: Partial<Record<Slot, string>> = {};
    if (license?.frontPath) paths.licenseFront = license.frontPath;
    if (license?.backPath) paths.licenseBack = license.backPath;
    if (address?.frontPath) paths.address = address.frontPath;
    if (Object.keys(paths).length === 0) { setRemote({}); return; }

    Promise.all(
      Object.entries(paths).map(async ([slot, path]) => {
        try { return [slot, await documentImageUrl(path as string)] as const; }
        catch { return [slot, ''] as const; }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setRemote(Object.fromEntries(pairs.filter(([, v]) => v)) as Partial<Record<Slot, string>>);
    });
    return () => { cancelled = true; };
  }, [license?.frontPath, license?.backPath, address?.frontPath, verified]);

  const capture = async (slot: Slot, source: 'camera' | 'library') => {
    try {
      const uri = await pickDocumentImage(source, slot === 'address' ? 'addressProof' : 'driverLicense');
      if (uri) setLocal((prev) => ({ ...prev, [slot]: uri }));
    } catch (e: any) {
      Alert.alert('Could not open', e?.message || 'Please try again.');
    }
  };

  // A slot is "ready" if freshly picked OR already stored.
  const has = (slot: Slot): boolean =>
    !!local[slot] ||
    (slot === 'licenseFront' && !!license?.frontPath) ||
    (slot === 'licenseBack' && !!license?.backPath) ||
    (slot === 'address' && !!address?.frontPath);

  const allReady = SLOTS.every((s) => has(s.key));
  const dirty = !!local.licenseFront || !!local.licenseBack || !!local.address;
  // A rejected set can't be re-sent as-is: FoodyzzHQ refused these exact images and
  // asked for the licence again plus a DIFFERENT proof of address, so every slot has
  // to carry a freshly captured photo before Submit unlocks.
  const allFresh = SLOTS.every((s) => !!local[s.key]);
  const blockedOnRetake = !!rejected && !allFresh;

  const submit = async () => {
    if (!allReady) {
      Alert.alert('All three needed', 'Add the front and back of your license and your proof of address.');
      return;
    }
    if (blockedOnRetake) {
      Alert.alert(
        'New photos needed',
        'Your last submission was rejected. Take a new photo of both sides of your license and use a different proof of address.',
      );
      return;
    }
    setBusy(true);
    try {
      // Upload only what changed; reuse stored paths for anything untouched.
      const licenseFront = local.licenseFront
        ? await uploadDocumentImage('driverLicense', 'front', local.licenseFront)
        : license.frontPath;
      const licenseBack = local.licenseBack
        ? await uploadDocumentImage('driverLicense', 'back', local.licenseBack)
        : license.backPath;
      const addressFront = local.address
        ? await uploadDocumentImage('addressProof', 'front', local.address)
        : address.frontPath;

      // Save both — a re-submit of either resets BOTH to unreviewed so the pair is
      // always verified together.
      await saveDocumentToProfile('driverLicense', licenseFront, licenseBack);
      await saveDocumentToProfile('addressProof', addressFront);

      setLocal({});
      setReplacing(false);
      onSaved?.();
      Alert.alert('Documents submitted', 'FoodyzzHQ will verify your ID and proof of address before delivery.');
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message || 'Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const renderSlot = (slot: Slot, label: string) => {
    // While replacing, a stored image stays sealed — only the freshly picked one shows.
    const uri = local[slot] || (verified ? undefined : remote[slot]);
    const sealed = masked || (replacing && !local[slot]);
    return (
      <View key={slot} className="flex-1 mx-1">
        <Text className="text-[9px] font-black text-slate-400 uppercase tracking-wide mb-1">{label}</Text>
        <View
          className={`border-2 rounded-xl overflow-hidden h-20 items-center justify-center ${
            sealed ? 'border-emerald-300 bg-emerald-50' : 'border-black bg-slate-100'
          }`}
        >
          {uri ? (
            <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
          ) : sealed ? (
            <>
              <Lock size={16} color="#059669" />
              <Text className="text-[8px] font-black uppercase text-emerald-600 tracking-widest mt-1">On file</Text>
            </>
          ) : slot === 'address' ? (
            <FileText size={22} color="#94a3b8" />
          ) : (
            <CreditCard size={22} color="#94a3b8" />
          )}
        </View>
        {/* Capture controls disappear while masked — "Upload new documents" brings
            them back rather than leaving them sitting under verified documents. */}
        {!masked && (
          <View className="flex-row mt-1.5">
            <TouchableOpacity
              onPress={() => capture(slot, 'camera')}
              className="flex-1 mr-0.5 py-1.5 border-2 border-black rounded-lg bg-white items-center"
            >
              <Text className="text-[8px] font-black uppercase text-slate-700">Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => capture(slot, 'library')}
              className="flex-1 ml-0.5 py-1.5 border-2 border-black rounded-lg bg-white items-center"
            >
              <Text className="text-[8px] font-black uppercase text-slate-700">Upload</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  return (
    <View className="border-2 border-black rounded-2xl bg-white p-4 shadow-brutalist">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center">
          <CreditCard size={18} color="#4338ca" />
          <Text className="ml-2 font-black text-slate-800 uppercase">Identity documents</Text>
        </View>
        {verified ? (
          <View className="flex-row items-center">
            <CheckCircle size={14} color="#059669" />
            <Text className="ml-1 text-[10px] font-black text-emerald-600 uppercase">Verified</Text>
          </View>
        ) : rejected ? (
          // Rejected documents are still "on file" (the images stay until replaced),
          // so this has to win over the In-review badge below or the card would claim
          // FoodyzzHQ is still looking at a set they've already refused.
          <View className="flex-row items-center">
            <AlertTriangle size={14} color="#dc2626" />
            <Text className="ml-1 text-[10px] font-black text-red-600 uppercase">Action needed</Text>
          </View>
        ) : bothOnFile ? (
          <View className="flex-row items-center">
            <Clock size={14} color="#eab308" />
            <Text className="ml-1 text-[10px] font-black text-yellow-600 uppercase">In review</Text>
          </View>
        ) : null}
      </View>

      <Text className="text-[11px] font-bold text-slate-400 mb-3">
        {masked
          ? 'Your driver license and proof of address are verified and kept sealed. Upload new ones any time — a replacement goes back to FoodyzzHQ for review.'
          : subtitle ||
            'Driver license (both sides) and a proof of address — a utility bill, bank statement or lease. Submit all three together to skip the ID check at delivery.'}
      </Text>

      {rejected ? (
        <View className="border-2 border-red-200 bg-red-50 rounded-xl px-3 py-2 mb-3">
          <Text className="text-[11px] font-bold text-red-600">
            {license?.rejectedReason || address?.rejectedReason}
          </Text>
        </View>
      ) : null}

      <View className="flex-row -mx-1">
        {SLOTS.map((s) => renderSlot(s.key, s.label))}
      </View>

      {/* Verified + masked: the only action is to start a replacement. */}
      {masked && (
        <TouchableOpacity
          onPress={() => setReplacing(true)}
          className="mt-4 py-3 rounded-xl border-2 border-black items-center bg-white flex-row justify-center"
        >
          <ShieldCheck size={14} color="#059669" />
          <Text className="ml-2 font-black uppercase text-[11px] text-slate-700">Upload new documents</Text>
        </TouchableOpacity>
      )}

      {/* Only actionable once all three are present, so a partial set never reaches
          the reviewer. While replacing verified documents, at least one new image is
          required — otherwise "submit" would just re-send the same approved set. */}
      {!masked && (dirty || !bothOnFile || !!rejected) && (() => {
        const ready = allReady && !(replacing && !dirty) && !blockedOnRetake;
        return (
        <TouchableOpacity
          disabled={busy || !ready}
          onPress={submit}
          className={`mt-4 py-3 rounded-xl border-2 border-black items-center shadow-brutalist ${
            ready ? 'bg-brand-green' : 'bg-slate-200'
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text className={`font-black uppercase ${ready ? 'text-black' : 'text-slate-400'}`}>
              {blockedOnRetake
                ? 'Retake all three to submit'
                : allReady ? 'Submit documents' : 'Add all three to submit'}
            </Text>
          )}
        </TouchableOpacity>
        );
      })()}

      {replacing && (
        <TouchableOpacity
          onPress={() => { setLocal({}); setReplacing(false); }}
          disabled={busy}
          className="mt-2 py-2.5 items-center"
        >
          <Text className="font-black uppercase text-[10px] text-slate-400">Cancel — keep verified documents</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
