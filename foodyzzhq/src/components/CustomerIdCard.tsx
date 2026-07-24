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
import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, Image, ActivityIndicator, Alert, Linking, Modal, ScrollView,
} from 'react-native';
import storage from '@react-native-firebase/storage';
import { CreditCard, CheckCircle, Clock, Send, Phone, MessageSquare, X } from 'lucide-react-native';
import { db, auth } from '../services/firebase';

interface Props {
  order: any;
  // Opens the in-app chat thread with this customer.
  onMessage?: () => void;
}

type DocKind = 'driverLicense' | 'addressProof';

const DOC_LABEL: Record<DocKind, string> = {
  driverLicense: 'Driver license',
  addressProof: 'Proof of address',
};

// A licence needs both sides; proof of address is a single page.
const isComplete = (doc: any, kind: DocKind): boolean =>
  kind === 'driverLicense' ? !!doc?.frontPath && !!doc?.backPath : !!doc?.frontPath;

export default function CustomerIdCard({ order, onMessage }: Props) {
  const [profile, setProfile] = useState<any>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [requesting, setRequesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [zoom, setZoom] = useState<string | null>(null);

  useEffect(() => {
    if (!order?.customerPhone) return;
    return db.collection('users').doc(order.customerPhone).onSnapshot(
      (snap) => { if (snap?.exists) setProfile(snap.data()); },
      (e) => console.warn('CustomerIdCard: user listener failed', e),
    );
  }, [order?.customerPhone]);

  const license = profile?.driverLicense;
  const address = profile?.addressProof;
  const licenseReady = isComplete(license, 'driverLicense');
  const addressReady = isComplete(address, 'addressProof');
  // Both documents present is what turns "waiting" into "review me".
  const allUploaded = licenseReady && addressReady;
  // Verification is per-ORDER, keyed on order.docsVerifiedAt — the same stamp the
  // Dispatch card's "Ready for Delivery" gate reads. A returning customer whose
  // documents were reviewed on a PRIOR order still needs staff to confirm them for
  // this one, so we deliberately don't treat the profile's reviewedAt as verified
  // here — otherwise the card would show "verified" while the order gate stayed
  // locked with no button to unlock it.
  const allVerified = allUploaded && !!order.docsVerifiedAt;

  // Resolve every present image to a display URL.
  useEffect(() => {
    let cancelled = false;
    const paths: Record<string, string> = {};
    if (license?.frontPath) paths['license-front'] = license.frontPath;
    if (license?.backPath) paths['license-back'] = license.backPath;
    if (address?.frontPath) paths['address-front'] = address.frontPath;
    if (Object.keys(paths).length === 0) { setUrls({}); return; }

    Promise.all(
      Object.entries(paths).map(async ([key, path]) => {
        try { return [key, await storage().ref(path).getDownloadURL()] as const; }
        catch { return [key, ''] as const; }
      }),
    ).then((pairs) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(pairs.filter(([, v]) => v)));
    });
    return () => { cancelled = true; };
  }, [license?.frontPath, license?.backPath, address?.frontPath]);

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
        recipientPhone: order.customerPhone,
        text:
          'Before we deliver your bike we need a photo of your driver license (front and back) ' +
          'and proof of address. You can upload them from Account in the Foodyzz app.',
        timestamp: new Date().toISOString(),
      });
      Alert.alert('Request sent', 'The customer has been notified to upload their documents.');
    } catch (e: any) {
      Alert.alert('Could not send request', e?.message || 'Please try again.');
    } finally {
      setRequesting(false);
    }
  };

  // Approving stamps BOTH documents and the order; docsVerifiedAt is what unlocks
  // "Ready for Delivery" on the order card.
  const verifyDocuments = async () => {
    setVerifying(true);
    const now = new Date().toISOString();
    const by = order.providerId || null;
    try {
      await db.collection('users').doc(order.customerPhone).set(
        {
          driverLicense: { ...license, reviewedAt: now, reviewedBy: by, rejectedReason: null },
          addressProof: { ...address, reviewedAt: now, reviewedBy: by, rejectedReason: null },
        },
        { merge: true },
      );
      await db.collection('orders').doc(order.id).update({ docsVerifiedAt: now });
    } catch (e: any) {
      Alert.alert('Could not verify', e?.message || 'Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const renderDoc = (kind: DocKind, keys: string[]) => {
    const doc = kind === 'driverLicense' ? license : address;
    if (!isComplete(doc, kind)) return null;
    return (
      <View className="mb-3">
        <Text className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">
          {DOC_LABEL[kind]}
        </Text>
        <View className="flex-row">
          {keys.map((key) => (
            <TouchableOpacity
              key={key}
              className="flex-1 mr-2"
              onPress={() => urls[key] && setZoom(urls[key])}
              activeOpacity={0.8}
            >
              <View className="border border-slate-200 rounded-xl overflow-hidden bg-slate-100 h-24 items-center justify-center">
                {urls[key] ? (
                  <Image source={{ uri: urls[key] }} className="w-full h-full" resizeMode="cover" />
                ) : (
                  <ActivityIndicator size="small" color="#94a3b8" />
                )}
              </View>
            </TouchableOpacity>
          ))}
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
        ) : allUploaded ? (
          <View className="flex-row items-center">
            <Clock size={13} color="#eab308" />
            <Text className="ml-1 text-[9px] font-black text-yellow-600 uppercase">Needs review</Text>
          </View>
        ) : null}
      </View>

      {allUploaded ? (
        <View>
          {renderDoc('driverLicense', ['license-front', 'license-back'])}
          {renderDoc('addressProof', ['address-front'])}

          {!allVerified && (
            <TouchableOpacity
              onPress={verifyDocuments}
              disabled={verifying}
              className="bg-[#86B54F] py-3 rounded-xl items-center border-2 border-black mt-1"
              style={{ opacity: verifying ? 0.6 : 1 }}
            >
              {verifying ? (
                <ActivityIndicator size="small" color="black" />
              ) : (
                <Text className="text-black font-black uppercase text-[10px] tracking-widest">
                  Verify documents
                </Text>
              )}
            </TouchableOpacity>
          )}

          {allVerified && (
            <View className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              <Text className="text-[10px] font-bold text-emerald-700">
                Documents verified — this order can go out for delivery.
              </Text>
            </View>
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
          <Text className="text-[10px] font-bold text-slate-400 mb-3">
            {order.idRequestedAt
              ? 'Waiting for the customer to upload their driver license and proof of address. This card updates automatically.'
              : 'No documents on file. Request the customer’s ID and proof of address before delivery.'}
          </Text>

          {/* Partial upload — say which half is still missing rather than nothing. */}
          {(licenseReady || addressReady) && (
            <View className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3">
              <Text className="text-[10px] font-bold text-amber-700">
                Received: {licenseReady ? 'driver license' : 'proof of address'}. Still waiting on{' '}
                {licenseReady ? 'proof of address' : 'the driver license'}.
              </Text>
            </View>
          )}

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
                  {order.idRequestedAt ? 'Request sent' : 'Request ID & address proof'}
                </Text>
              </View>
            )}
          </TouchableOpacity>
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
