// Staff review of one customer's verification (identity, proof of address,
// sign-up location) — what the Foodyzz customer app collects before a Rent or
// Rent to Buy checkout. Everything is read and decided through callables
// (adminGetCustomerVerification / adminReviewCustomerVerification): the record in
// customerKyc/{phone} is server-only, and the derived status on the users doc is
// server-written, so staff never write either directly.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, ActivityIndicator, Alert, TextInput, Linking, Modal, ScrollView } from 'react-native';
import storage from '@react-native-firebase/storage';
import firebase from '@react-native-firebase/app';
import '@react-native-firebase/functions';
import { ScanFace, FileText, MapPin, AlertTriangle, RefreshCw, X, ShieldCheck } from 'lucide-react-native';
import { syncAdminClaim } from '../services/firebase';

type Target = 'identity' | 'address' | 'location';

const callable = (name: string) => firebase.app().functions('us-central1').httpsCallable(name);

const STATE_LABEL: Record<string, string> = {
  not_started: 'Not started', in_progress: 'In progress', failed: 'Didit declined', in_review: 'Needs review',
  rejected: 'Rejected', verified: 'Verified', waiting: 'Waiting on ID', needs_document: 'Needs document',
  too_far: 'Too far', action_required: 'Customer to act',
};

function Pill({ state }: { state: string }) {
  const [box, text] = state === 'verified' ? ['bg-emerald-50 border-emerald-200', 'text-emerald-700']
    : state === 'in_review' ? ['bg-amber-50 border-amber-200', 'text-amber-700']
      : ['failed', 'rejected', 'too_far'].includes(state) ? ['bg-red-50 border-red-200', 'text-red-700']
        : ['bg-slate-50 border-slate-200', 'text-slate-600'];
  return (
    <View className={`px-2 py-0.5 rounded-lg border ${box}`}>
      <Text className={`text-[9px] font-black uppercase ${text}`}>{STATE_LABEL[state] ?? state}</Text>
    </View>
  );
}

function Row({ k, v }: { k: string; v?: React.ReactNode }) {
  if (v === undefined || v === null || v === '') return null;
  return (
    <View className="flex-row justify-between py-1 border-b border-slate-100">
      <Text className="text-[10px] font-bold text-slate-400 uppercase mr-3">{k}</Text>
      <Text className="text-[11px] font-bold text-slate-800 flex-1 text-right">{v}</Text>
    </View>
  );
}

// A storage path from a manual submission, resolved for display. Staff read these
// folders under storage.rules (hqStaff / admin).
function DocImage({ path, label, onZoom }: { path?: string; label: string; onZoom: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setUrl(null); setFailed(false);
    if (!path) return;
    storage().ref(path).getDownloadURL()
      .then((u) => { if (!cancelled) setUrl(u); })
      .catch(async () => {
        // Usually a token minted before this person got staff access.
        await syncAdminClaim(true).catch(() => {});
        storage().ref(path).getDownloadURL()
          .then((u) => { if (!cancelled) setUrl(u); })
          .catch(() => { if (!cancelled) setFailed(true); });
      });
    return () => { cancelled = true; };
  }, [path]);
  if (!path) return null;
  return (
    <TouchableOpacity className="flex-1 mr-2" disabled={!url} onPress={() => url && onZoom(url)}>
      <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">{label}</Text>
      <View className="h-24 rounded-xl border border-slate-200 bg-slate-100 overflow-hidden items-center justify-center">
        {url ? <Image source={{ uri: url }} className="w-full h-full" resizeMode="cover" />
          : failed ? <AlertTriangle size={16} color="#dc2626" /> : <ActivityIndicator size="small" color="#94a3b8" />}
      </View>
    </TouchableOpacity>
  );
}

export default function CustomerVerificationPanel({ phone }: { phone: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res: any = await callable('adminGetCustomerVerification')({ phone });
      setData(res?.data ?? null);
    } catch (e: any) {
      setError(e?.code === 'functions/permission-denied'
        ? 'This device isn’t authorised to view verification yet. Tap retry — staff access is re-checked.'
        : 'Could not load verification.');
      if (e?.code === 'functions/permission-denied') await syncAdminClaim(true).catch(() => {});
    } finally {
      setLoading(false);
    }
  }, [phone]);
  useEffect(() => { load(); }, [load]);

  const decide = (target: Target, decision: 'approved' | 'rejected') => {
    if (decision === 'rejected' && !note.trim()) {
      Alert.alert('Add a note', 'Write a short note first — the customer sees it and it tells them what to fix.');
      return;
    }
    const what = target === 'identity' ? 'the ID photos' : target === 'address' ? 'the proof of address' : 'the sign-up location';
    Alert.alert(
      decision === 'approved' ? `Approve ${what}?` : `Reject ${what}?`,
      decision === 'approved'
        ? (target === 'location' ? 'This overrides the location check for the current delivery address.' : 'The customer is notified.')
        : 'The customer is notified with your note and asked to try again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: decision === 'approved' ? 'Approve' : 'Reject',
          style: decision === 'approved' ? 'default' : 'destructive',
          onPress: async () => {
            setDeciding(`${target}:${decision}`);
            try {
              await callable('adminReviewCustomerVerification')({ phone, target, decision, note: note.trim() || undefined });
              setNote('');
              await load();
            } catch (e: any) {
              Alert.alert('Could not save', e?.message || 'Please try again.');
            } finally {
              setDeciding(null);
            }
          },
        },
      ],
    );
  };

  const Buttons = ({ target, canApprove = true, canReject = true }: { target: Target; canApprove?: boolean; canReject?: boolean }) => (
    <View className="flex-row mt-2">
      {canApprove && (
        <TouchableOpacity
          onPress={() => decide(target, 'approved')}
          disabled={!!deciding}
          className="flex-1 bg-[#86B54F] py-2.5 rounded-xl items-center border-2 border-black mr-2"
          style={{ opacity: deciding ? 0.6 : 1 }}
        >
          {deciding === `${target}:approved` ? <ActivityIndicator size="small" color="#000" />
            : <Text className="text-black font-black uppercase text-[10px] tracking-widest">{target === 'location' ? 'Override · approve' : 'Approve'}</Text>}
        </TouchableOpacity>
      )}
      {canReject && (
        <TouchableOpacity
          onPress={() => decide(target, 'rejected')}
          disabled={!!deciding}
          className="flex-1 bg-red-50 py-2.5 rounded-xl items-center border-2 border-red-500"
          style={{ opacity: deciding ? 0.6 : 1 }}
        >
          {deciding === `${target}:rejected` ? <ActivityIndicator size="small" color="#dc2626" />
            : <Text className="text-red-600 font-black uppercase text-[10px] tracking-widest">Reject</Text>}
        </TouchableOpacity>
      )}
    </View>
  );

  if (loading && !data) {
    return <View className="py-6 items-center"><ActivityIndicator color="#507425" /></View>;
  }
  if (error) {
    return (
      <TouchableOpacity onPress={load} className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 flex-row items-center">
        <RefreshCw size={13} color="#dc2626" />
        <Text className="ml-2 flex-1 text-[10px] font-bold text-red-700">{error}</Text>
      </TouchableOpacity>
    );
  }
  if (!data) return null;

  const v = data.verification ?? {};
  const k = data.kyc ?? {};
  const d = k.didit ?? {};
  const loc = k.location?.forAddress === data.currentAddress ? k.location : null;
  const ipl = loc?.ipLocation;
  const idReview = k.identityReview;
  const addrReview = k.addressReview?.forAddress === data.currentAddress ? k.addressReview : null;
  const legalName = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ');

  const section = (icon: React.ReactNode, title: string, state: string, body: React.ReactNode) => (
    <View className="border border-slate-200 rounded-2xl p-3 mb-3 bg-white">
      <View className="flex-row items-center justify-between mb-1">
        <View className="flex-row items-center">
          {icon}
          <Text className="ml-2 text-[10px] font-black text-black uppercase tracking-widest">{title}</Text>
        </View>
        <Pill state={state} />
      </View>
      {body}
    </View>
  );

  return (
    <View>
      <View className="flex-row items-center justify-between mb-3">
        <View className="flex-row items-center">
          <ShieldCheck size={15} color="#507425" />
          <Text className="ml-2 text-[10px] font-black text-black uppercase tracking-widest">Verification</Text>
        </View>
        <View className="flex-row items-center">
          <Pill state={v.status} />
          <TouchableOpacity onPress={load} className="ml-2 p-1"><RefreshCw size={13} color="#64748b" /></TouchableOpacity>
        </View>
      </View>
      {!data.required && (
        <Text className="text-[10px] font-bold text-slate-400 mb-2">
          Checkout gate is off (apiConfig/global.verification.required) — customers can rent without this yet.
        </Text>
      )}

      {section(<ScanFace size={14} color="#000" />, 'Identity', v.identity, (
        <View>
          {data.portrait && (
            <TouchableOpacity onPress={() => setZoom(data.portrait)} className="self-start mt-2 mb-1">
              <Image source={{ uri: data.portrait }} className="w-20 h-20 rounded-xl border border-slate-200" />
            </TouchableOpacity>
          )}
          <Row k="Didit" v={d.status} />
          <Row k="Legal name" v={legalName} />
          <Row k="Date of birth" v={d.dateOfBirth} />
          <Row k="Document" v={[d.documentType, d.issuingState].filter(Boolean).join(' · ')} />
          <Row k="Expires" v={d.documentExpiry} />
          <Row k="ID address" v={d.idAddress} />
          <Row k="Liveness / face" v={d.livenessScore != null || d.faceMatchScore != null ? `${d.livenessScore ?? '—'} / ${d.faceMatchScore ?? '—'}` : undefined} />
          <Row k="Didit IP" v={[d.ipCity, d.ipState, d.ipCountry].filter(Boolean).join(', ') + (d.vpn ? ' · VPN' : '') + (d.proxy ? ' · proxy' : '')} />
          {d.warnings?.length ? <Text className="text-[10px] font-bold text-amber-700 mt-1">Warnings: {d.warnings.join(', ')}</Text> : null}
          {idReview?.licenseFront && (
            <View className="mt-2">
              <Text className="text-[9px] font-black text-slate-500 uppercase mb-1">
                Manual upload · {idReview.status}{idReview.reviewedBy ? ` by ${idReview.reviewedBy}` : ''}{idReview.note ? ` — ${idReview.note}` : ''}
              </Text>
              <View className="flex-row">
                <DocImage path={idReview.licenseFront} label="Licence front" onZoom={setZoom} />
                <DocImage path={idReview.licenseBack} label="Licence back" onZoom={setZoom} />
                <DocImage path={idReview.selfie} label="Selfie" onZoom={setZoom} />
              </View>
            </View>
          )}
          {v.identity === 'in_review' && idReview?.status === 'submitted' && <Buttons target="identity" />}
          {v.identity === 'in_review' && idReview?.status !== 'submitted' && (
            <Text className="text-[10px] font-bold text-slate-500 mt-2">Didit sent this to manual review — decide it in the Didit console (business.didit.me).</Text>
          )}
        </View>
      ))}

      {section(<FileText size={14} color="#000" />, 'Proof of address', v.address, (
        <View>
          <Row k="Delivery ZIP / ID ZIP" v={`${String(data.currentAddress).split('|')[1] || '—'} / ${d.idZip || '—'}`} />
          {addrReview?.document && (
            <View className="flex-row mt-2">
              <DocImage path={addrReview.document} label={`Document · ${addrReview.status}`} onZoom={setZoom} />
            </View>
          )}
          {addrReview?.note ? <Text className="text-[10px] font-bold text-slate-500 mt-1">Note: {addrReview.note}</Text> : null}
          {v.address === 'in_review' && <Buttons target="address" />}
          {/* No upload yet, but the licence may show the delivery address. */}
          {(v.address === 'needs_document' || v.address === 'waiting') && v.identity === 'verified' && (
            <Buttons target="address" canReject={false} />
          )}
        </View>
      ))}

      {section(<MapPin size={14} color="#000" />, 'Sign-up location', v.location, (
        <View>
          {loc ? (
            <>
              <Row k="Distance" v={typeof loc.distanceMiles === 'number' ? `${loc.distanceMiles} mi (limit ${data.radiusMiles})` : 'No map coordinates on the delivery address'} />
              <Row k="GPS accuracy" v={loc.accuracyM != null ? `±${Math.round(loc.accuracyM)} m` : undefined} />
              <Row k="Captured" v={loc.capturedAt ? new Date(loc.capturedAt).toLocaleString() : undefined} />
              <Row k="IP" v={loc.ip} />
              <Row k="IP location" v={ipl ? [ipl.city, ipl.region, ipl.countryCode || ipl.country].filter(Boolean).join(', ') + (ipl.proxy ? ' · PROXY' : '') : 'Lookup unavailable'} />
              <Row k="Network" v={ipl?.network} />
              <TouchableOpacity
                onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${loc.deviceLat},${loc.deviceLng}` +
                  (typeof loc.addressLat === 'number' ? `&destination=${loc.addressLat},${loc.addressLng}` : ''))}
                className="mt-2 self-start"
              >
                <Text className="text-[10px] font-black text-indigo-700 uppercase">Open phone → address in Maps</Text>
              </TouchableOpacity>
            </>
          ) : (
            <Text className="text-[10px] font-bold text-slate-400 mt-1">No location check for the current delivery address yet.</Text>
          )}
          {k.locationReview?.forAddress === data.currentAddress && (
            <Text className="text-[10px] font-bold text-slate-500 mt-1">
              Staff {k.locationReview.status} by {k.locationReview.reviewedBy}{k.locationReview.note ? ` — ${k.locationReview.note}` : ''}
            </Text>
          )}
          {v.location !== 'verified' && <Buttons target="location" canReject={!!loc} />}
        </View>
      ))}

      <TextInput
        value={note}
        onChangeText={setNote}
        placeholder="Note to the customer (required to reject)"
        placeholderTextColor="#94a3b8"
        multiline
        maxLength={500}
        className="border border-slate-200 rounded-xl px-3 py-2 text-[12px] text-black bg-slate-50"
      />

      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <View className="flex-1 bg-black/90 items-center justify-center p-4">
          <TouchableOpacity onPress={() => setZoom(null)} className="absolute top-16 right-6 z-10">
            <X size={28} color="#ffffff" />
          </TouchableOpacity>
          <ScrollView maximumZoomScale={4} minimumZoomScale={1} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} style={{ width: '100%' }}>
            {zoom && <Image source={{ uri: zoom }} style={{ width: '100%', height: 360 }} resizeMode="contain" />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

