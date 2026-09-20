// Customer document review, shown on an accepted rental order.
//
// The flow the project spec asks for:
//   Accept Order
//     → repeat customer with documents already on file: show them, staff verify
//     → no documents: request them, which alerts the customer to upload
//   → customer uploads in the Foodyzz app
//   → this card switches to VERIFY
//   → verifying stamps docsVerifiedAt, which unlocks "Ready for Delivery"
//
// Review is deliberately manual: staff eyeball the images and can reach the
// customer by phone or in-app chat if anything looks wrong.
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator, Alert, Linking, Modal, ScrollView,
} from 'react-native';
import storage from '@react-native-firebase/storage';
import * as Print from 'expo-print';
import { CreditCard, CheckCircle, Clock, Send, Phone, MessageSquare, X, AlertTriangle, RefreshCw, XCircle, Printer, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react-native';
import CustomerVerificationPanel from './CustomerVerificationPanel';
import { db, auth, syncAdminClaim } from '../services/firebase';
import {
  buildWorkerLabelHtml, imageAsDataUrl, isPrintCancelled, LABEL_WIDTH_PT, LABEL_HEIGHT_PT,
} from '../services/workerLabel';

interface Props {
  order: any;
  // Opens the in-app chat thread with this customer.
  onMessage?: () => void;
}

type DocKind = 'driverLicense' | 'addressProof' | 'selfie';

const DOC_LABEL: Record<DocKind, string> = {
  driverLicense: 'Driver license',
  addressProof: 'Proof of address',
  selfie: 'Selfie — match to the license photo',
};

// A licence needs both sides; proof of address and the selfie are a single image.
const isComplete = (doc: any, kind: DocKind): boolean =>
  kind === 'driverLicense' ? !!doc?.frontPath && !!doc?.backPath : !!doc?.frontPath;

// Per-image resolution state. Failure has to be distinguishable from "still
// fetching": a plain `url ?? spinner` renders a permanent spinner on a denied read,
// which reads as a slow network and hides the actual cause (see `hint` below).
type ImageState =
  | { status: 'loading' }
  | { status: 'ok'; url: string }
  | { status: 'error'; code?: string };

// The one rejection reason staff send. It is stored on BOTH documents so the
// customer app can render it, and it is what the customer's push says: their pair
// was refused and a fresh licence plus a DIFFERENT proof of address is needed.
const REJECTION_REASON =
  'Your identity check was rejected. Please re-upload your driver license, a new selfie and a different proof of address.';

// storage/unauthorized here means the staff `admin` claim is missing from this
// device's token — the documents exist, we just can't read them. Anything else is
// a genuinely missing object or a network fault.
const errorHint = (code?: string): string =>
  code === 'storage/unauthorized'
    ? 'No access — staff permissions'
    : code === 'storage/object-not-found'
      ? 'File missing'
      : 'Could not load';

export default function CustomerIdCard({ order, onMessage }: Props) {
  const [profile, setProfile] = useState<any>(null);
  const [images, setImages] = useState<Record<string, ImageState>>({});
  const [reloadKey, setReloadKey] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  // A second tap before the re-render would present a second print sheet.
  const printingRef = useRef(false);
  const [zoom, setZoom] = useState<string | null>(null);
  const [showKyc, setShowKyc] = useState(false);

  useEffect(() => {
    if (!order?.customerPhone) return;
    return db.collection('users').doc(order.customerPhone).onSnapshot(
      (snap) => { if (snap?.exists) setProfile(snap.data()); },
      (e) => console.warn('CustomerIdCard: user listener failed', e),
    );
  }, [order?.customerPhone]);

  const license = profile?.driverLicense;
  const address = profile?.addressProof;
  const selfie = profile?.selfie;
  const licenseReady = isComplete(license, 'driverLicense');
  const addressReady = isComplete(address, 'addressProof');
  const selfieReady = isComplete(selfie, 'selfie');
  // All three present is what turns "waiting" into "review me".
  const allUploaded = licenseReady && addressReady && selfieReady;
  // Verification is per-ORDER, keyed on order.docsVerifiedAt — the same stamp the
  // Dispatch card's "Ready for Delivery" gate reads. A returning customer whose
  // documents were reviewed on a PRIOR order still needs staff to confirm them for
  // this one, so we deliberately don't treat the profile's reviewedAt as verified
  // here — otherwise the card would show "verified" while the order gate stayed
  // locked with no button to unlock it.
  //
  // The selfie is NOT required here: an order verified before the selfie was asked
  // for stays verified rather than falling back to "request documents".
  // Verified in the customer app (Didit ID + address + sign-up location, see
  // CustomerVerificationPanel). Server-written, so it can stand in for the
  // uploaded pair: staff still confirm it per order, with one tap.
  const kycVerified = profile?.verification?.status === 'verified';
  const allVerified = !!order.docsVerifiedAt && ((licenseReady && addressReady) || kycVerified);
  // Rejected until the customer submits again — every submission clears
  // rejectedReason, so this flips back off by itself.
  const rejected = !allVerified && !!(license?.rejectedReason || address?.rejectedReason || selfie?.rejectedReason);

  // Resolve every present image to a display URL, keeping per-image status so a
  // failure surfaces as a retryable error tile rather than an endless spinner.
  useEffect(() => {
    let cancelled = false;
    const paths: Record<string, string> = {};
    if (license?.frontPath) paths['license-front'] = license.frontPath;
    if (license?.backPath) paths['license-back'] = license.backPath;
    if (address?.frontPath) paths['address-front'] = address.frontPath;
    if (selfie?.frontPath) paths['selfie-front'] = selfie.frontPath;
    if (Object.keys(paths).length === 0) { setImages({}); return; }

    setImages(Object.fromEntries(
      Object.keys(paths).map((key) => [key, { status: 'loading' } as ImageState]),
    ));

    Promise.all(
      Object.entries(paths).map(async ([key, path]) => {
        try {
          return [key, { status: 'ok', url: await storage().ref(path).getDownloadURL() }] as const;
        } catch (e: any) {
          // Logged, not swallowed — the code is the whole diagnosis.
          console.warn(`CustomerIdCard: ${path} failed [${e?.code}]`, e?.message);
          return [key, { status: 'error', code: e?.code }] as const;
        }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setImages(Object.fromEntries(pairs));
    });
    return () => { cancelled = true; };
  }, [license?.frontPath, license?.backPath, address?.frontPath, selfie?.frontPath, reloadKey]);

  const anyFailed = Object.values(images).some((s) => s.status === 'error');
  const deniedFailure = Object.values(images).some(
    (s) => s.status === 'error' && s.code === 'storage/unauthorized',
  );

  // Re-run the fetch. On a permission failure, re-sync the staff claim first: the
  // usual cause is a token issued before the account was added to the allowlist,
  // and re-syncing refreshes it so the retry actually has a chance to succeed.
  const retryImages = async () => {
    if (deniedFailure) await syncAdminClaim(true).catch(() => {});
    setReloadKey((k) => k + 1);
  };

  // Flags the order so the customer app prompts, and posts a chat record. The push
  // itself is sent by the onOrderIdDocsRequested Cloud Function, which triggers off
  // idRequestedAt — so this write deliberately omits senderRole, which would make
  // onProviderMessageSent fire a duplicate generic "new message" alert.
  const requestDocuments = async () => {
    setRequesting(true);
    try {
      await db.collection('orders').doc(order.id).update({
        idRequestedAt: new Date().toISOString(),
        idRequestedBy: order.providerId,
      });
      await db.collection('messages').add({
        orderId: order.id,
        senderPhone: auth().currentUser?.phoneNumber || order.providerId,
        senderName: order.providerName || 'FoodyzzHQ',
        source: 'order',
        recipientPhone: order.customerPhone,
        text:
          'Before we deliver your bike we need a photo of your driver license (front and back), ' +
          'a proof of address and a selfie. You can upload them from Account in the Foodyzz app.',
        timestamp: new Date().toISOString(),
      });
      Alert.alert('Request sent', 'The customer has been notified to upload their documents.');
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  // Worker ID label — the same 3.5" × 2.25" Zebra label the rider can print from My
  // Profile. Goes through the phone's own print system to whatever printer this
  // device is already set up with; there is no in-app printer management.
  const printLabel = async () => {
    if (printingRef.current) return;
    if (!selfie?.frontPath) {
      Alert.alert('No selfie on file', 'This customer has no selfie yet, so a worker ID label cannot be printed.');
      return;
    }
    // Issued by the server when the customer onboarded; missing only for a moment
    // after that, or if issuing failed.
    if (!profile?.workerId) {
      Alert.alert('No worker ID yet', 'This customer’s worker ID has not been issued yet. Try again in a moment.');
      return;
    }
    printingRef.current = true;
    setPrinting(true);
    try {
      // The card already resolved the selfie for display — reuse that URL.
      const shown = images['selfie-front'];
      const url = shown?.status === 'ok' ? shown.url : await storage().ref(selfie.frontPath).getDownloadURL();
      const selfieDataUrl = await imageAsDataUrl(url);
      await Print.printAsync({
        html: buildWorkerLabelHtml({
          name: profile?.name || order.customerName || '',
          workerId: profile.workerId,
          selfieDataUrl,
        }),
        width: LABEL_WIDTH_PT,
        height: LABEL_HEIGHT_PT,
        // The label draws its own padding; iOS would otherwise add a default margin.
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
      });
    } catch (e: any) {
      if (isPrintCancelled(e)) return;
      Alert.alert(
        'Label did not print',
        'Check the Zebra printer is on and connected to this phone, then tap Print worker ID label to try again.',
      );
    } finally {
      printingRef.current = false;
      setPrinting(false);
    }
  };

  // Approving stamps ALL THREE documents and the order; docsVerifiedAt is what
  // unlocks "Ready for Delivery" on the order card. A successful approval then
  // opens the worker ID label straight away.
  const verifyDocuments = async () => {
    setVerifying(true);
    const now = new Date().toISOString();
    const by = order.providerId || null;
    let approved = false;
    try {
      await db.collection('users').doc(order.customerPhone).set(
        {
          driverLicense: { ...license, reviewedAt: now, reviewedBy: by, rejectedReason: null },
          addressProof: { ...address, reviewedAt: now, reviewedBy: by, rejectedReason: null },
          // Never write a selfie map for a customer without one — it would carry a
          // review stamp and no image.
          ...(selfie ? { selfie: { ...selfie, reviewedAt: now, reviewedBy: by, rejectedReason: null } } : {}),
        },
        { merge: true },
      );
      await db.collection('orders').doc(order.id).update({ docsVerifiedAt: now });
      approved = true;
    } catch (e: any) {
      Alert.alert('Could not verify', e?.message || 'Please try again.');
    } finally {
      setVerifying(false);
    }
    if (approved) await printLabel();
  };

  // A customer verified in-app has nothing to eyeball here; confirming stamps the
  // same docsVerifiedAt the document approval does, then prints the badge.
  const confirmVerifiedCustomer = async () => {
    setVerifying(true);
    let ok = false;
    try {
      await db.collection('orders').doc(order.id).update({ docsVerifiedAt: new Date().toISOString() });
      ok = true;
    } catch (e: any) {
      Alert.alert('Could not confirm', e?.message || 'Please try again.');
    } finally {
      setVerifying(false);
    }
    if (ok && selfieReady) await printLabel();
  };

  // Rejecting is the mirror of approving: it clears the review stamps and writes the
  // reason onto BOTH documents, which is what the customer app renders and what the
  // onUserWriteLifecycleEmails trigger turns into an "ID check rejected" push. The
  // customer's next upload clears rejectedReason, putting the pair back in review.
  const rejectDocuments = () => {
    Alert.alert(
      'Reject documents?',
      'The customer is told their identity check failed and asked to upload their driver ' +
      'license again plus a DIFFERENT proof of address. This order stays blocked until they do.',
      [
        { text: 'Keep reviewing', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setRejecting(true);
            const now = new Date().toISOString();
            const by = order.providerId || null;
            try {
              await db.collection('users').doc(order.customerPhone).set(
                {
                  driverLicense: { ...license, reviewedAt: null, reviewedBy: null, rejectedReason: REJECTION_REASON },
                  addressProof: { ...address, reviewedAt: null, reviewedBy: null, rejectedReason: REJECTION_REASON },
                  ...(selfie ? { selfie: { ...selfie, reviewedAt: null, reviewedBy: null, rejectedReason: REJECTION_REASON } } : {}),
                },
                { merge: true },
              );
              // Clearing docsVerifiedAt re-locks "Ready for Delivery" even if this
              // order had already been approved once.
              await db.collection('orders').doc(order.id).update({
                docsVerifiedAt: null,
                docsRejectedAt: now,
              });
            } catch (e: any) {
              Alert.alert('Could not reject', e?.message || 'Please try again.');
            } finally {
              setRejecting(false);
            }
          },
        },
      ],
    );
  };

  const renderDoc = (kind: DocKind, keys: string[]) => {
    const doc = kind === 'driverLicense' ? license : kind === 'addressProof' ? address : selfie;
    if (!isComplete(doc, kind)) return null;
    return (
      <View className="mb-3">
        <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
          {DOC_LABEL[kind]}
        </Text>
        <View className="flex-row">
          {keys.map((key) => {
            const state = images[key] ?? { status: 'loading' as const };
            return (
              <TouchableOpacity
                key={key}
                className="flex-1 mr-2"
                onPress={() => {
                  if (state.status === 'ok') setZoom(state.url);
                  else if (state.status === 'error') retryImages();
                }}
                activeOpacity={0.8}
              >
                <View
                  className={`border rounded-xl overflow-hidden h-24 items-center justify-center px-1 ${
                    state.status === 'error'
                      ? 'border-red-200 bg-red-50'
                      : 'border-slate-200 bg-slate-100'
                  }`}
                >
                  {state.status === 'ok' ? (
                    <Image source={{ uri: state.url }} className="w-full h-full" resizeMode="cover" />
                  ) : state.status === 'error' ? (
                    <>
                      <AlertTriangle size={16} color="#dc2626" />
                      <Text className="text-[8px] font-black text-red-600 uppercase tracking-wide text-center mt-1">
                        {errorHint(state.code)}
                      </Text>
                      <Text className="text-[8px] font-bold text-red-400 uppercase tracking-wide mt-0.5">
                        Tap to retry
                      </Text>
                    </>
                  ) : (
                    <ActivityIndicator size="small" color="#94a3b8" />
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View className="mt-3 border-2 border-black rounded-2xl bg-white p-4">
      <View className="flex-row items-center justify-between mb-2">
        <View className="flex-row items-center">
          <CreditCard size={15} color="#4338ca" />
          <Text className="ml-2 font-black text-black text-[10px] uppercase tracking-widest">
            Customer documents
          </Text>
        </View>
        {allVerified ? (
          <View className="flex-row items-center">
            <CheckCircle size={13} color="#059669" />
            <Text className="ml-1 text-[9px] font-black text-emerald-600 uppercase">Verified</Text>
          </View>
        ) : rejected ? (
          <View className="flex-row items-center">
            <XCircle size={13} color="#dc2626" />
            <Text className="ml-1 text-[9px] font-black text-red-600 uppercase">Rejected</Text>
          </View>
        ) : allUploaded ? (
          <View className="flex-row items-center">
            <Clock size={13} color="#eab308" />
            <Text className="ml-1 text-[9px] font-black text-yellow-600 uppercase">Needs review</Text>
          </View>
        ) : null}
      </View>

      {allUploaded || allVerified ? (
        <View>
          {renderDoc('driverLicense', ['license-front', 'license-back'])}
          {renderDoc('addressProof', ['address-front'])}
          {renderDoc('selfie', ['selfie-front'])}

          {/* Never let staff approve documents they could not actually see. */}
          {anyFailed && (
            <TouchableOpacity
              onPress={retryImages}
              className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2 flex-row items-center"
            >
              <RefreshCw size={13} color="#dc2626" />
              <Text className="ml-2 flex-1 text-[10px] font-bold text-red-700">
                {/* Tapping is usually the whole fix: this screen calls
                    syncAdminClaim(force), and document access follows store
                    membership via the hqStaff claim, which a token minted before
                    the person joined does not carry. Deliberately does NOT tell
                    them to ask for the staff list — that grants platform admin,
                    which is far more than viewing documents needs. */}
                {deniedFailure
                  ? 'This device isn’t authorised yet. Tap to retry — if it keeps failing, ask an admin to confirm you were added to this store.'
                  : 'Some documents could not be loaded. Tap to retry.'}
              </Text>
            </TouchableOpacity>
          )}

          {/* Already rejected — the pair is refused and we're waiting on a new upload.
              Approve stays available so a mis-tap can be undone without the customer
              having to re-send anything. */}
          {rejected && (
            <View className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 mb-2">
              <Text className="text-[10px] font-bold text-red-700">
                Rejected — the customer has been asked to upload a new license and a different
                proof of address. This card updates when they do.
              </Text>
            </View>
          )}

          {!allVerified && (
            <View className="flex-row mt-1">
              <TouchableOpacity
                onPress={verifyDocuments}
                disabled={verifying || rejecting || anyFailed}
                className="flex-1 bg-[#86B54F] py-3 rounded-xl items-center justify-center border-2 border-black"
                style={{ opacity: verifying || rejecting || anyFailed ? 0.6 : 1 }}
              >
                {verifying ? (
                  <ActivityIndicator size="small" color="black" />
                ) : (
                  <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                    Approve
                  </Text>
                )}
              </TouchableOpacity>

              {!rejected && (
                <TouchableOpacity
                  onPress={rejectDocuments}
                  disabled={verifying || rejecting || anyFailed}
                  className="flex-1 ml-2 bg-red-50 py-3 rounded-xl flex-row items-center justify-center border-2 border-red-500"
                  style={{ opacity: verifying || rejecting || anyFailed ? 0.6 : 1 }}
                >
                  {rejecting ? (
                    <ActivityIndicator size="small" color="#dc2626" />
                  ) : (
                    <>
                      <XCircle size={13} color="#dc2626" />
                      <Text className="ml-1.5 text-red-600 font-black uppercase text-[10px] tracking-widest">
                        Reject
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}

          {allVerified && (
            <View className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <Text className="text-[10px] font-bold text-emerald-700">
                Documents verified — this order can go out for delivery.
              </Text>
            </View>
          )}

          {/* Manual (re)print — the label opens automatically on approval, this is
              for a jammed or disconnected printer. Needs a selfie, so orders
              verified before selfies were asked for can't print one. */}
          {allVerified && (
            <TouchableOpacity
              onPress={printLabel}
              disabled={printing || !selfieReady}
              className={`mt-2 py-2.5 rounded-xl flex-row items-center justify-center border-2 ${
                selfieReady ? 'bg-white border-black' : 'bg-slate-50 border-slate-200'
              }`}
            >
              {printing ? (
                <ActivityIndicator size="small" color="#000000" />
              ) : (
                <>
                  <Printer size={13} color={selfieReady ? '#000000' : '#cbd5e1'} />
                  <Text
                    className={`ml-2 font-black uppercase text-[10px] tracking-widest ${
                      selfieReady ? 'text-black' : 'text-slate-300'
                    }`}
                  >
                    {selfieReady ? 'Print worker ID label' : 'No selfie — no label'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <View className="flex-row mt-3">
            <TouchableOpacity
              onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}
              className="px-4 bg-slate-50 py-2.5 rounded-xl items-center border border-slate-200 mr-2"
            >
              <Phone size={13} color="#475569" />
            </TouchableOpacity>
            {onMessage && (
              <TouchableOpacity
                onPress={onMessage}
                className="px-4 bg-slate-50 py-2.5 rounded-xl items-center border border-slate-200"
              >
                <MessageSquare size={13} color="#475569" />
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        <View>
          {kycVerified && (
            <View className="mb-3">
              <View className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mb-2 flex-row items-center">
                <ShieldCheck size={13} color="#059669" />
                <Text className="ml-2 flex-1 text-[10px] font-bold text-emerald-700">
                  Verified in the Foodyzz app — ID, address and sign-up location. No documents needed.
                </Text>
              </View>
              <TouchableOpacity
                onPress={confirmVerifiedCustomer}
                disabled={verifying}
                className="bg-[#86B54F] py-3 rounded-xl items-center justify-center border-2 border-black"
                style={{ opacity: verifying ? 0.6 : 1 }}
              >
                {verifying ? <ActivityIndicator size="small" color="black" /> : (
                  <Text className="text-black font-black uppercase text-[10px] tracking-widest">Confirm identity for this order</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
          <Text className="text-[10px] font-bold text-slate-400 mb-3">
            {order.idRequestedAt
              ? 'Waiting for the customer to upload their driver license, proof of address and selfie. This card updates automatically.'
              : 'Documents incomplete. Request the customer’s ID, proof of address and selfie before delivery.'}
          </Text>

          {/* Partial upload — say what is still missing rather than nothing. A
              customer verified before the selfie was asked for lands here too. */}
          {(licenseReady || addressReady || selfieReady) && (() => {
            const parts: [boolean, string][] = [
              [licenseReady, 'driver license'],
              [addressReady, 'proof of address'],
              [selfieReady, 'selfie'],
            ];
            const received = parts.filter(([ok]) => ok).map(([, name]) => name).join(', ');
            const missing = parts.filter(([ok]) => !ok).map(([, name]) => name).join(', ');
            return (
              <View className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
                <Text className="text-[10px] font-bold text-amber-700">
                  Received: {received}. Still waiting on: {missing}.
                </Text>
              </View>
            );
          })()}

          <TouchableOpacity
            disabled={requesting || !!order.idRequestedAt}
            onPress={requestDocuments}
            className={`py-2.5 rounded-xl items-center flex-row justify-center border ${
              order.idRequestedAt ? 'bg-slate-50 border-slate-200' : 'bg-indigo-50 border-indigo-200'
            }`}
          >
            {requesting ? (
              <ActivityIndicator size="small" color="#507425" />
            ) : (
              <View className="flex-row items-center">
                {order.idRequestedAt ? (
                  <Clock size={13} color="#94a3b8" />
                ) : (
                  <Send size={13} color="#507425" />
                )}
                <Text
                  className={`ml-2 font-black uppercase text-[9px] tracking-widest ${
                    order.idRequestedAt ? 'text-slate-400' : 'text-indigo-700'
                  }`}
                >
                  {order.idRequestedAt ? 'Request sent' : 'Request ID, address proof & selfie'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* In-app verification record (Didit result, IP, GPS distance) and its review. */}
      {!!profile?.verification && (
        <View className="mt-3 border-t border-slate-100 pt-3">
          <TouchableOpacity onPress={() => setShowKyc((x) => !x)} className="flex-row items-center justify-between">
            <Text className="text-[9px] font-black text-slate-500 uppercase tracking-widest">
              App verification · {String(profile.verification.status).replace(/_/g, ' ')}
            </Text>
            {showKyc ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
          </TouchableOpacity>
          {showKyc && <View className="mt-3"><CustomerVerificationPanel phone={order.customerPhone} /></View>}
        </View>
      )}

      {/* Full-screen look at one document — a thumbnail is too small to actually verify. */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <View className="flex-1 bg-black/90 items-center justify-center p-4">
          <TouchableOpacity onPress={() => setZoom(null)} className="absolute top-16 right-6 z-10">
            <X size={28} color="#ffffff" />
          </TouchableOpacity>
          <ScrollView
            maximumZoomScale={4}
            minimumZoomScale={1}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
            style={{ width: '100%' }}
          >
            {zoom && <Image source={{ uri: zoom }} style={{ width: '100%', height: 300 }} resizeMode="contain" />}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
