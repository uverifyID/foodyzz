// Verification before Rent / Rent to Buy — three checks, each on its own card:
//
//   1. Identity   — Didit's ID + selfie check. If it doesn't pass, the customer can
//                   upload their licence and a selfie for FoodyzzHQ to review.
//   2. Address    — passes by itself when the ID shows the delivery address's ZIP;
//                   otherwise a proof of address is uploaded for review.
//   3. Location   — tapped while at the delivery address; the phone's position is
//                   compared with it on the server.
//
// Every state shown here comes from users/{phone}.verification, written by the
// server (functions/src/customerVerification.ts) and delivered by the profile
// listener, so a webhook or a staff decision updates this screen live.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, ActivityIndicator, Image, Linking } from 'react-native';
import {
  ChevronLeft, ScanFace, FileText, MapPinCheck, CheckCircle, Clock, AlertTriangle, Camera, ImageIcon, ShieldCheck,
} from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUserProfile } from '../context/UserProfileContext';
import { COLORS } from '../theme';
import { friendlyError } from '../services/errors';
import { pickDocumentImage, uploadDocumentImage, saveDocumentsToProfile, DocKind } from '../services/customerDocuments';
import {
  EMPTY_VERIFICATION, runIdentityCheck, pollVerification, getVerificationStatus, submitVerificationDocuments,
  checkLocationAtAddress, isAlreadyVerified, type VerificationStatusResponse,
} from '../services/verification';

type Tone = 'ok' | 'wait' | 'warn' | 'todo';

const TONE_STYLE: Record<Tone, { box: string; text: string; icon: string }> = {
  ok: { box: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700', icon: '#059669' },
  wait: { box: 'bg-amber-50 border-amber-200', text: 'text-amber-700', icon: '#d97706' },
  warn: { box: 'bg-red-50 border-red-200', text: 'text-red-700', icon: '#dc2626' },
  todo: { box: 'bg-slate-50 border-slate-200', text: 'text-slate-600', icon: '#64748b' },
};

function StatusLine({ tone, text }: { tone: Tone; text: string }) {
  const s = TONE_STYLE[tone];
  const Icon = tone === 'ok' ? CheckCircle : tone === 'wait' ? Clock : tone === 'warn' ? AlertTriangle : ShieldCheck;
  return (
    <View className={`flex-row items-start border rounded-xl px-3 py-2 mt-3 ${s.box}`}>
      <Icon size={14} color={s.icon} style={{ marginTop: 1 }} />
      <Text className={`ml-2 flex-1 text-[11px] font-bold leading-relaxed ${s.text}`}>{text}</Text>
    </View>
  );
}

function PrimaryButton({ label, onPress, busy, disabled }: { label: string; onPress: () => void; busy?: boolean; disabled?: boolean }) {
  const off = busy || disabled;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={off}
      className="mt-3 bg-brand-green py-3 rounded-xl items-center justify-center border-2 border-black"
      style={{ opacity: off ? 0.6 : 1 }}
    >
      {busy ? <ActivityIndicator size="small" color="#000000" /> : (
        <Text className="text-black font-black uppercase text-[11px] tracking-widest">{label}</Text>
      )}
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      className="mt-2 py-2.5 rounded-xl items-center border-2 border-black bg-white"
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      <Text className="text-black font-black uppercase text-[10px] tracking-widest">{label}</Text>
    </TouchableOpacity>
  );
}

function Step({ n, title, icon, children }: { n: number; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <View className="bg-white border-2 border-black rounded-3xl p-5 mb-4">
      <View className="flex-row items-center">
        <View className="w-10 h-10 rounded-2xl bg-slate-100 border-2 border-black items-center justify-center">{icon}</View>
        <View className="ml-3 flex-1">
          <Text className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Step {n}</Text>
          <Text className="text-base font-black text-black uppercase">{title}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

// One image slot for a manual upload: take a photo or pick one.
function Slot({ label, uri, onPick, disabled }: {
  label: string; uri?: string; onPick: (src: 'camera' | 'library') => void; disabled?: boolean;
}) {
  return (
    <View className="flex-1 mr-2">
      <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</Text>
      <View className="h-20 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 overflow-hidden items-center justify-center">
        {uri ? <Image source={{ uri }} className="w-full h-full" resizeMode="cover" /> : (
          <View className="flex-row">
            <TouchableOpacity disabled={disabled} onPress={() => onPick('camera')} className="p-2"><Camera size={18} color="#475569" /></TouchableOpacity>
            <TouchableOpacity disabled={disabled} onPress={() => onPick('library')} className="p-2"><ImageIcon size={18} color="#475569" /></TouchableOpacity>
          </View>
        )}
      </View>
      {uri && (
        <TouchableOpacity disabled={disabled} onPress={() => onPick('camera')} className="mt-1">
          <Text className="text-[9px] font-black text-slate-500 uppercase">Retake</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

type IdSlot = 'licenseFront' | 'licenseBack' | 'selfie';

export default function VerificationScreen() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { profile } = useUserProfile();
  const v = profile?.verification ?? EMPTY_VERIFICATION;

  const [status, setStatus] = useState<VerificationStatusResponse | null>(null);
  const [busy, setBusy] = useState<null | 'identity' | 'manual' | 'address' | 'location'>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const [showManual, setShowManual] = useState(false);
  const [idImages, setIdImages] = useState<Partial<Record<IdSlot, string>>>({});
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);

  // Refreshes a Didit session that is still running and fetches reviewer notes.
  const refresh = useCallback(async () => {
    try {
      const s = await getVerificationStatus();
      if (mounted.current) setStatus(s);
    } catch { /* the live profile status still shows */ }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // One action at a time — a second tap before re-render would start a second
  // Didit session or upload twice.
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(kind);
    try { await fn(); } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(null);
    }
  };

  // ── Identity ──────────────────────────────────────────────────────────────
  const startIdentity = () => run('identity', async () => {
    try {
      await runIdentityCheck();
    } catch (e: any) {
      if (!isAlreadyVerified(e)) {
        Alert.alert('Could not start the ID check', friendlyError(e, 'Please try again in a moment.'));
        return;
      }
    }
    const s = await pollVerification(() => mounted.current);
    if (s && mounted.current) setStatus(s);
  });

  const pickId = async (slot: IdSlot, src: 'camera' | 'library') => {
    try {
      const uri = await pickDocumentImage(src, slot === 'selfie' ? 'selfie' : 'driverLicense');
      if (uri) setIdImages((m) => ({ ...m, [slot]: uri }));
    } catch (e: any) {
      Alert.alert('Could not open the camera', friendlyError(e, 'Please try again.'));
    }
  };

  const submitManualId = () => run('manual', async () => {
    const { licenseFront, licenseBack, selfie } = idImages;
    if (!licenseFront || !licenseBack || !selfie) return;
    try {
      const [front, back, face] = await Promise.all([
        uploadDocumentImage('driverLicense', 'front', licenseFront),
        uploadDocumentImage('driverLicense', 'back', licenseBack),
        uploadDocumentImage('selfie', 'front', selfie),
      ]);
      await saveDocumentsToProfile({ driverLicense: { frontPath: front, backPath: back }, selfie: { frontPath: face } });
      await submitVerificationDocuments('identity');
      if (mounted.current) { setIdImages({}); setShowManual(false); }
      refresh();
    } catch (e: any) {
      Alert.alert('Upload failed', friendlyError(e, 'Could not send your photos. Please try again.'));
    }
  });

  // ── Address ───────────────────────────────────────────────────────────────
  const pickProof = async (src: 'camera' | 'library') => {
    try {
      const uri = await pickDocumentImage(src, 'addressProof' as DocKind);
      if (uri) setProofImage(uri);
    } catch (e: any) {
      Alert.alert('Could not open the camera', friendlyError(e, 'Please try again.'));
    }
  };

  const submitProof = () => run('address', async () => {
    if (!proofImage) return;
    try {
      const path = await uploadDocumentImage('addressProof', 'front', proofImage);
      await saveDocumentsToProfile({ addressProof: { frontPath: path } });
      await submitVerificationDocuments('address');
      if (mounted.current) setProofImage(null);
      refresh();
    } catch (e: any) {
      Alert.alert('Upload failed', friendlyError(e, 'Could not send your document. Please try again.'));
    }
  });

  // ── Location ──────────────────────────────────────────────────────────────
  const checkLocation = () => run('location', async () => {
    setLocationDenied(false);
    try {
      const res = await checkLocationAtAddress();
      if ('reason' in res) {
        if (res.reason === 'denied') setLocationDenied(true);
        else Alert.alert('Location unavailable', "We couldn't get a location fix. Make sure Location is on, move near a window, and try again.");
      }
      refresh();
    } catch (e: any) {
      Alert.alert('Could not check your location', friendlyError(e, 'Please try again.'));
    }
  });

  // ── Copy per state ────────────────────────────────────────────────────────
  const notes = status?.notes ?? {};
  const radius = status?.radiusMiles ?? 0.25;
  const idText: Record<string, [Tone, string]> = {
    not_started: ['todo', 'Scan your driver license or ID and take a short selfie with our verification partner Didit. Have your ID with you and find good light — it takes about 2 minutes.'],
    in_progress: ['wait', 'Your ID check is being processed. This usually takes under a minute.'],
    failed: ['warn', "Your ID check didn't pass. Try again with the whole card in frame and no glare — or upload photos of your licence and a selfie for our team to review."],
    in_review: ['wait', 'Our team is reviewing your ID. We will notify you — usually within a few hours.'],
    rejected: ['warn', `Your ID photos were not accepted.${notes.identity ? ` ${notes.identity}` : ''} Try the ID check again or upload new photos.`],
    verified: ['ok', 'Identity verified.'],
  };
  const addrText: Record<string, [Tone, string]> = {
    waiting: ['todo', "Once your ID is verified we check its address against your delivery address. If they don't match, you'll upload a proof of address."],
    needs_document: ['todo', "The address on your ID doesn't match your delivery address. Upload a utility bill, bank statement or lease from the last 90 days showing your name and delivery address."],
    in_review: ['wait', 'Our team is reviewing your proof of address.'],
    rejected: ['warn', `Your proof of address was not accepted.${notes.address ? ` ${notes.address}` : ''} Please upload a different document.`],
    verified: ['ok', 'Address verified.'],
  };
  const locText: Record<string, [Tone, string]> = {
    not_started: ['todo', "Your bike is delivered to the address on your profile, so we confirm you signed up from there. When you're at that address, tap below — we check your phone's location once."],
    too_far: ['warn', `Your phone wasn't at your delivery address (it must be within about ${radius} mi). Try again when you're there, or update your delivery address in Account.`],
    in_review: ['wait', 'Our team is double-checking your location. We will notify you when it is done.'],
    rejected: ['warn', `Your location check was not accepted.${notes.location ? ` ${notes.location}` : ''} Please try again from your delivery address.`],
    verified: ['ok', 'Location confirmed at your delivery address.'],
  };
  const [idTone, idMsg] = idText[v.identity] ?? idText.not_started;
  const [addrTone, addrMsg] = addrText[v.address] ?? addrText.waiting;
  const [locTone, locMsg] = locText[v.location] ?? locText.not_started;

  const canStartDidit = ['not_started', 'failed', 'rejected'].includes(v.identity);
  const canUploadId = ['failed', 'rejected'].includes(v.identity);
  const canUploadProof = ['needs_document', 'rejected'].includes(v.address);
  const canCheckLocation = v.location !== 'verified' && v.location !== 'in_review';
  const idReady = !!idImages.licenseFront && !!idImages.licenseBack && !!idImages.selfie;

  return (
    <View className="flex-1 bg-white">
      <View style={{ paddingTop: insets.top }} className="bg-white border-b-2 border-black">
        <View className="flex-row items-center px-4 pt-2 pb-3">
          <TouchableOpacity onPress={() => navigation.goBack()} className="p-1 mr-2" accessibilityLabel="Back">
            <ChevronLeft size={24} color="#000000" />
          </TouchableOpacity>
          <Text className="text-xl font-black text-black uppercase tracking-tighter">
            Get <Text className="text-brand-green-dark">Verified</Text>
          </Text>
        </View>
      </View>

      <ScrollView className="flex-1 px-4 pt-4" contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        {v.status === 'verified' ? (
          <StatusLine tone="ok" text="You're verified. You can rent or Rent to Buy a bike." />
        ) : (
          <Text className="text-xs font-bold text-slate-500 leading-relaxed mb-1">
            Before we deliver a rental bike we confirm who you are, where you live, and that you signed up from
            your delivery address. Your documents are only seen by the Foodyzz team.
          </Text>
        )}
        <View className="h-4" />

        <Step n={1} title="Identity" icon={<ScanFace size={20} color="#000000" />}>
          <StatusLine tone={idTone} text={idMsg} />
          {busy === 'identity' && <StatusLine tone="wait" text="Waiting for your result…" />}
          {canStartDidit && (
            <PrimaryButton label={v.identity === 'not_started' ? 'Start ID check' : 'Try the ID check again'} onPress={startIdentity} busy={busy === 'identity'} disabled={!!busy} />
          )}
          {v.identity === 'in_progress' && <SecondaryButton label="Check status" onPress={() => run('identity', refresh)} disabled={!!busy} />}
          {canUploadId && !showManual && (
            <SecondaryButton label="Upload licence & selfie instead" onPress={() => setShowManual(true)} disabled={!!busy} />
          )}
          {canUploadId && showManual && (
            <View className="mt-4">
              <Text className="text-[10px] font-bold text-slate-500 mb-2">
                Photograph both sides of your driver license, then take a selfie. Our team compares them.
              </Text>
              <View className="flex-row">
                <Slot label="License · front" uri={idImages.licenseFront} onPick={(s) => pickId('licenseFront', s)} disabled={!!busy} />
                <Slot label="License · back" uri={idImages.licenseBack} onPick={(s) => pickId('licenseBack', s)} disabled={!!busy} />
                <Slot label="Selfie" uri={idImages.selfie} onPick={(s) => pickId('selfie', 'camera')} disabled={!!busy} />
              </View>
              <PrimaryButton label="Send for review" onPress={submitManualId} busy={busy === 'manual'} disabled={!idReady || !!busy} />
            </View>
          )}
        </Step>

        <Step n={2} title="Proof of address" icon={<FileText size={20} color="#000000" />}>
          <StatusLine tone={addrTone} text={addrMsg} />
          {canUploadProof && (
            <View className="mt-3">
              <View className="flex-row">
                <Slot label="Document" uri={proofImage ?? undefined} onPick={pickProof} disabled={!!busy} />
              </View>
              <PrimaryButton label="Send for review" onPress={submitProof} busy={busy === 'address'} disabled={!proofImage || !!busy} />
            </View>
          )}
        </Step>

        <Step n={3} title="Sign-up location" icon={<MapPinCheck size={20} color="#000000" />}>
          {!!profile?.address && (
            <Text className="text-[11px] font-bold text-slate-700 mt-3">Delivery address: {profile.address}</Text>
          )}
          <StatusLine tone={locTone} text={locMsg} />
          {locationDenied && (
            <View className="mt-3">
              <StatusLine tone="warn" text="Location access is off for Foodyzz. Allow it in Settings, then tap the button again." />
              <SecondaryButton label="Open Settings" onPress={() => Linking.openSettings().catch(() => {})} />
            </View>
          )}
          {canCheckLocation && (
            <PrimaryButton label="I'm at my delivery address" onPress={checkLocation} busy={busy === 'location'} disabled={!!busy} />
          )}
          {v.location === 'too_far' && (
            <SecondaryButton label="Change delivery address" onPress={() => navigation.navigate('Main', { screen: 'Account' })} disabled={!!busy} />
          )}
        </Step>

        {v.status === 'in_review' && (
          <StatusLine tone="wait" text="Everything is in. Our team will finish the review and notify you — you can close this screen." />
        )}
        {busy && busy !== 'identity' && (
          <View className="items-center mt-2"><ActivityIndicator color={COLORS.brand.greenDark} /></View>
        )}
      </ScrollView>
    </View>
  );
}
