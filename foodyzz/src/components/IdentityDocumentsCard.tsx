// Identity documents — driver license (front + back), proof of address AND a selfie,
// captured and submitted TOGETHER. FoodyzzHQ verifies the set before a bike is
// released (the selfie is matched against the licence photo), so the customer can't
// submit a partial set: the button stays disabled until all four images are
// present, and one save writes every record at once.
//
// Used in Account → Profile, and right after FoodyzzHQ accepts an order.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { CreditCard, FileText, Camera, CheckCircle, Clock, ShieldCheck, Lock, AlertTriangle } from 'lucide-react-native';
import { friendlyError } from '../services/errors';
import {
  pickDocumentImage,
  uploadDocumentImage,
  saveIdentitySetToProfile,
  deleteDocumentImages,
  documentImageUrl,
  DocKind,
  DocSide,
} from '../services/customerDocuments';

interface Props {
  profile: any;
  subtitle?: string;
  onSaved?: () => void;
  // A selfie taken from outside the card (the selfie box on the profile header).
  // It drops into the selfie slot as if taken here, and still has to be submitted
  // with the rest of the set.
  incomingSelfie?: string | null;
  // The not-yet-submitted selfie, reported whenever it changes (taken, retaken,
  // discarded, or cleared by a successful submit) so the profile header can show it.
  onSelfieDraftChange?: (uri: string | null) => void;
}

// The four images this card collects.
type Slot = 'licenseFront' | 'licenseBack' | 'address' | 'selfie';
const SLOTS: { key: Slot; label: string }[] = [
  { key: 'licenseFront', label: 'License · Front' },
  { key: 'licenseBack', label: 'License · Back' },
  { key: 'address', label: 'Proof of address' },
  { key: 'selfie', label: 'Selfie' },
];

const STORAGE_FOR: Record<Slot, { kind: DocKind; side: DocSide }> = {
  licenseFront: { kind: 'driverLicense', side: 'front' },
  licenseBack: { kind: 'driverLicense', side: 'back' },
  address: { kind: 'addressProof', side: 'front' },
  selfie: { kind: 'selfie', side: 'front' },
};

export default function IdentityDocumentsCard({ profile, subtitle, onSaved, incomingSelfie, onSelfieDraftChange }: Props) {
  const license = profile?.driverLicense;
  const address = profile?.addressProof;
  const selfie = profile?.selfie;

  const [local, setLocal] = useState<Partial<Record<Slot, string>>>({});
  const [remote, setRemote] = useState<Partial<Record<Slot, string>>>({});
  const [busy, setBusy] = useState(false);
  // `busy` disables the button only from the next render; this blocks a double tap
  // landing before it, which would upload and save the set twice.
  const submittingRef = useRef(false);
  // Verified documents are masked by default. This flips the card back into
  // capture mode so a customer can replace them (new licence, moved address).
  const [replacing, setReplacing] = useState(false);

  // The full set present AND reviewed is the fully-verified state. A customer
  // verified before the selfie was asked for is NOT verified here — they have the
  // pair but no selfie, so the card opens for them to add one.
  const pairOnFile = !!license?.frontPath && !!license?.backPath && !!address?.frontPath;
  const allOnFile = pairOnFile && !!selfie?.frontPath;
  const verified = allOnFile && !!license?.reviewedAt && !!address?.reviewedAt && !!selfie?.reviewedAt;
  const rejected = license?.rejectedReason || address?.rejectedReason || selfie?.rejectedReason;
  // Once FoodyzzHQ has verified them there's no reason to keep a customer's licence
  // and address proof rendered in their account — the card shows a sealed placeholder
  // and the verified badge instead. Uploading a replacement unmasks the tiles for
  // the new images only.
  const masked = verified && !replacing;

  useEffect(() => {
    if (!incomingSelfie) return;
    setLocal((prev) => ({ ...prev, selfie: incomingSelfie }));
    if (verified) setReplacing(true);
  }, [incomingSelfie]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onSelfieDraftChange?.(local.selfie ?? null);
  }, [local.selfie]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    // Never resolve download URLs for a VERIFIED customer — not just while masked.
    // Their stored images are sealed even mid-replacement (renderSlot shows only the
    // freshly picked one), so fetching them is Storage round-trips whose results
    // can never be displayed.
    if (verified) { setRemote({}); return; }
    const paths: Partial<Record<Slot, string>> = {};
    if (license?.frontPath) paths.licenseFront = license.frontPath;
    if (license?.backPath) paths.licenseBack = license.backPath;
    if (address?.frontPath) paths.address = address.frontPath;
    if (selfie?.frontPath) paths.selfie = selfie.frontPath;
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
  }, [license?.frontPath, license?.backPath, address?.frontPath, selfie?.frontPath, verified]);

  const capture = async (slot: Slot, source: 'camera' | 'library') => {
    try {
      const uri = await pickDocumentImage(source, STORAGE_FOR[slot].kind);
      if (uri) setLocal((prev) => ({ ...prev, [slot]: uri }));
    } catch (e: any) {
      Alert.alert('Could not open', friendlyError(e, 'We could not open that document. Please try again.'));
    }
  };

  // The path each slot currently has on the profile.
  const storedPath = (slot: Slot): string | undefined =>
    slot === 'licenseFront' ? license?.frontPath
      : slot === 'licenseBack' ? license?.backPath
        : slot === 'address' ? address?.frontPath
          : selfie?.frontPath;

  // A slot is "ready" if freshly picked OR already stored.
  const has = (slot: Slot): boolean => !!local[slot] || !!storedPath(slot);

  const allReady = SLOTS.every((s) => has(s.key));
  const dirty = SLOTS.some((s) => !!local[s.key]);
  // A rejected set can't be re-sent as-is: FoodyzzHQ refused these exact images and
  // asked for the licence again plus a DIFFERENT proof of address, so every slot has
  // to carry a freshly captured photo before Submit unlocks.
  const allFresh = SLOTS.every((s) => !!local[s.key]);
  const blockedOnRetake = !!rejected && !allFresh;

  const submit = async () => {
    if (submittingRef.current) return;
    if (!allReady) {
      Alert.alert('All four needed', 'Add the front and back of your license, your proof of address and a selfie.');
      return;
    }
    if (blockedOnRetake) {
      Alert.alert(
        'New photos needed',
        'Your last submission was rejected. Take a new photo of both sides of your license and a new selfie, and use a different proof of address.',
      );
      return;
    }
    submittingRef.current = true;
    setBusy(true);
    const uploaded: string[] = [];
    try {
      // Upload only what changed, all at once; reuse stored paths for the rest.
      // allSettled rather than all: every upload must have finished before a
      // failure is handled, or one still in flight would land after the cleanup.
      const results = await Promise.allSettled(
        SLOTS.map(async ({ key }) => {
          const uri = local[key];
          if (!uri) return storedPath(key) as string;
          const { kind, side } = STORAGE_FOR[key];
          const path = await uploadDocumentImage(kind, side, uri);
          uploaded.push(path);
          return path;
        }),
      );
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
      const [licenseFront, licenseBack, addressFront, selfieFront] =
        results.map((r) => (r as PromiseFulfilledResult<string>).value);

      // One write for the set — a re-submit of any of them resets ALL to unreviewed
      // so they are always verified together.
      await saveIdentitySetToProfile({ licenseFront, licenseBack, address: addressFront, selfie: selfieFront });

      // The profile now points at the new images; the ones they replaced are dead.
      deleteDocumentImages(SLOTS.filter((s) => local[s.key]).map((s) => storedPath(s.key)));

      setLocal({});
      setReplacing(false);
      onSaved?.();
      Alert.alert('Documents submitted', 'FoodyzzHQ will verify your ID, proof of address and selfie before delivery.');
    } catch (e: any) {
      // Nothing points at this attempt's uploads — the stored set is untouched.
      deleteDocumentImages(uploaded);
      Alert.alert('Upload failed', friendlyError(e, 'That upload did not complete. Check your connection and try again.'));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  };

  const renderSlot = (slot: Slot, label: string) => {
    // While replacing, a stored image stays sealed — only the freshly picked one shows.
    const uri = local[slot] || (verified ? undefined : remote[slot]);
    const sealed = masked || (replacing && !local[slot]);
    return (
      <View key={slot} className="w-1/2 px-1 mb-3">
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
          ) : slot === 'selfie' ? (
            <Camera size={22} color="#94a3b8" />
          ) : slot === 'address' ? (
            <FileText size={22} color="#94a3b8" />
          ) : (
            <CreditCard size={22} color="#94a3b8" />
          )}
        </View>
        {/* Capture controls disappear while masked — "Upload new documents" brings
            them back rather than leaving them sitting under verified documents.
            The selfie is camera-only: it has to be a live photo of the rider, not
            one pulled from the gallery. */}
        {!masked && (
          slot === 'selfie' ? (
            <TouchableOpacity
              onPress={() => capture(slot, 'camera')}
              className="mt-1.5 py-1.5 border-2 border-black rounded-lg bg-white items-center"
            >
              <Text className="text-[8px] font-black uppercase text-slate-700">Take selfie</Text>
            </TouchableOpacity>
          ) : (
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
          )
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
        ) : allOnFile ? (
          <View className="flex-row items-center">
            <Clock size={14} color="#eab308" />
            <Text className="ml-1 text-[10px] font-black text-yellow-600 uppercase">In review</Text>
          </View>
        ) : pairOnFile ? (
          // Licence and address from before the selfie was asked for.
          <View className="flex-row items-center">
            <Camera size={14} color="#d97706" />
            <Text className="ml-1 text-[10px] font-black text-amber-600 uppercase">Selfie needed</Text>
          </View>
        ) : null}
      </View>

      <Text className="text-[11px] font-bold text-slate-400 mb-3">
        {masked
          ? 'Your driver license, proof of address and selfie are verified and kept sealed. Upload new ones any time — a replacement goes back to FoodyzzHQ for review.'
          : subtitle ||
            'Driver license (both sides), a proof of address — a utility bill, bank statement or lease — and a selfie. Submit all four together to skip the ID check at delivery.'}
      </Text>

      {rejected ? (
        <View className="border-2 border-red-200 bg-red-50 rounded-xl px-3 py-2 mb-3">
          <Text className="text-[11px] font-bold text-red-600">{rejected}</Text>
        </View>
      ) : null}

      <View className="flex-row flex-wrap -mx-1">
        {SLOTS.map((s) => renderSlot(s.key, s.label))}
      </View>

      {/* Verified + masked: the only action is to start a replacement. */}
      {masked && (
        <TouchableOpacity
          onPress={() => setReplacing(true)}
          className="mt-1 py-3 rounded-xl border-2 border-black items-center bg-white flex-row justify-center"
        >
          <ShieldCheck size={14} color="#059669" />
          <Text className="ml-2 font-black uppercase text-[11px] text-slate-700">Upload new documents</Text>
        </TouchableOpacity>
      )}

      {/* Only actionable once all four are present, so a partial set never reaches
          the reviewer. While replacing verified documents, at least one new image is
          required — otherwise "submit" would just re-send the same approved set. */}
      {!masked && (dirty || !allOnFile || !!rejected) && (() => {
        const ready = allReady && !(replacing && !dirty) && !blockedOnRetake;
        return (
        <TouchableOpacity
          disabled={busy || !ready}
          onPress={submit}
          className={`mt-1 py-3 rounded-xl border-2 border-black items-center shadow-brutalist ${
            ready ? 'bg-brand-green' : 'bg-slate-200'
          }`}
        >
          {busy ? (
            <ActivityIndicator color="#000000" />
          ) : (
            <Text className={`font-black uppercase ${ready ? 'text-black' : 'text-slate-400'}`}>
              {blockedOnRetake
                ? 'Retake all four to submit'
                : allReady ? 'Submit documents' : 'Add all four to submit'}
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
