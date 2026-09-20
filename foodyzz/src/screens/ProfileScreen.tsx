import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Switch, Modal, ActivityIndicator, Linking, KeyboardAvoidingView, Image, Platform } from 'react-native';
import { User, Mail, MapPin, MessageSquare, CreditCard, AlertTriangle, ChevronRight, Edit2, X, Trash2, ShieldCheck, LogOut, Bell, Volume2, Camera, Printer } from 'lucide-react-native';
import * as Print from 'expo-print';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { previewSound } from '../services/soundPlayer';
import { COLORS, LAYOUT } from '../theme';
import { db, subscribeToGlobalConfig, getFunctionsInstance, signOutClean } from '../services/firebase';
import { extractZip, geocodeAddress } from '../services/geo';
import { GlobalConfig } from '../types';
import authNative from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStripe, CardField } from '@stripe/stripe-react-native';
import AddressAutocomplete from '../components/AddressAutocomplete';
import IdentityDocumentsCard from '../components/IdentityDocumentsCard';
import EmailConfirmField from '../components/EmailConfirmField';
import { useUserProfile } from '../context/UserProfileContext';
import { friendlyError, friendlyPaymentError, logHandledError } from '../services/errors';
import { normalizeEmail } from '../services/emailVerification';
import { pickDocumentImage, documentImageUrl, areDocumentsVerified } from '../services/customerDocuments';
import { buildWorkerLabelHtml, imageAsDataUrl, isPrintCancelled, LABEL_WIDTH_PT, LABEL_HEIGHT_PT } from '../services/workerLabel';
import {
    DELIVER_SAFELY_URL,
    COMPLETION_ID_MAX_LENGTH,
    sanitizeCompletionId,
    isValidCompletionId,
} from '../services/bikeSafety';

export default function ProfileScreen() {
    const navigation = useNavigation<any>();
    // insets.top backs the in-screen header (the native one is off to avoid the
    // iOS 26 bar-item capsule); insets.bottom is for the edit sheet, which as a
    // Modal covers the whole window including the nav bar.
    const insets = useSafeAreaInsets();
    const { bottom } = insets;
    const [user, setUser] = useState(authNative().currentUser);
    // Profile now comes from the shared single listener (UserProfileContext) rather
    // than a duplicate per-screen users/{phone} onSnapshot.
    const { profile, loading } = useUserProfile();
    const [globalConfig, setGlobalConfig] = useState<GlobalConfig | null>(null);
    const [validatingAddress, setValidatingAddress] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

    // Notification sound preference
    const [soundEnabled, setSoundEnabled] = useState(true);

    // Edit form states
    const [editName, setEditName] = useState('');
    const [editEmail, setEditEmail] = useState('');
    // Set by EmailConfirmField once a code sent to this address has come back.
    const [emailConfirmed, setEmailConfirmed] = useState(false);
    const [editAddress, setEditAddress] = useState('');
    const [editCompletionId, setEditCompletionId] = useState('');

    // Selfie box in the profile header. A capture there is handed to the identity
    // documents card (pendingSelfie) — it is submitted with the licence and proof of
    // address, never on its own — and the screen scrolls down to that card.
    const scrollRef = useRef<ScrollView>(null);
    const docsCardY = useRef(0);
    const [pendingSelfie, setPendingSelfie] = useState<string | null>(null);
    // What the card actually holds (reported back by it) — this, not pendingSelfie,
    // is what the header shows, so a selfie discarded in the card leaves the header.
    const [draftSelfie, setDraftSelfie] = useState<string | null>(null);
    const [selfieUrl, setSelfieUrl] = useState<string | null>(null);
    const [printingLabel, setPrintingLabel] = useState(false);
    // A second tap before the re-render would present a second print sheet.
    const printingLabelRef = useRef(false);

    // Card management
    const { createPaymentMethod } = useStripe();
    const [cardName, setCardName] = useState('');
    const [cardComplete, setCardComplete] = useState(false);
    const [isSavingCard, setIsSavingCard] = useState(false);
    const [isRemovingCard, setIsRemovingCard] = useState(false);
    const [showCardEntry, setShowCardEntry] = useState(false);

    // Keep user in sync with Firebase Auth state so the effect re-runs
    // if currentUser resolves after the initial render.
    useEffect(() => {
        return authNative().onAuthStateChanged((u) => setUser(u));
    }, []);

    useEffect(() => {
        const unsub = subscribeToGlobalConfig((cfg: GlobalConfig) => setGlobalConfig(cfg));
        return unsub;
    }, []);

    useEffect(() => {
        AsyncStorage.getItem('@notification_sound_enabled').then((val) => {
            if (val !== null) setSoundEnabled(val !== 'false');
        });
    }, []);

    // Header drawn in-screen (see `header` below) rather than via a native one: on
    // iOS 26 UIKit wraps a custom headerRight in its own shared-background capsule,
    // which painted a grey pill behind the Edit button. react-native-screens 4.11
    // exposes no way to opt a bar item out of it.
    useLayoutEffect(() => {
        navigation.setOptions({ headerShown: false });
    }, [navigation]);

    // Seed the edit form when it OPENS, not on every profile snapshot. users/{phone}
    // is rewritten in the background (badge counts, the server's worker ID stamp), and
    // re-seeding on each snapshot wiped whatever the customer was typing.
    const startEditing = () => {
        setEditName(profile?.name || '');
        setEditEmail(profile?.email || '');
        setEmailConfirmed(false);
        setEditAddress(profile?.address || '');
        setEditCompletionId(profile?.bikeSafetyCompletionId || '');
        setIsEditing(true);
    };

    // One download URL for the stored selfie, re-resolved only when it is replaced.
    const selfiePath = profile?.selfie?.frontPath;
    useEffect(() => {
        if (!selfiePath) { setSelfieUrl(null); return; }
        let cancelled = false;
        documentImageUrl(selfiePath)
            .then((url) => { if (!cancelled) setSelfieUrl(url); })
            .catch(() => { if (!cancelled) setSelfieUrl(null); });
        return () => { cancelled = true; };
    }, [selfiePath]);

    const handleTakeSelfie = async () => {
        try {
            const uri = await pickDocumentImage('camera', 'selfie');
            if (!uri) return;
            setPendingSelfie(uri);
            scrollRef.current?.scrollTo({ y: Math.max(docsCardY.current - 12, 0), animated: true });
        } catch (e: any) {
            Alert.alert('Could not open camera', friendlyError(e, 'We could not open the camera. Please try again.'));
        }
    };

    // Worker ID label (Zebra 3.5" × 2.25"). Only once FoodyzzHQ has verified the
    // licence, address and selfie — otherwise anyone could print a Foodyzz badge
    // carrying an unchecked photo — and the server has issued the worker ID.
    // A customer verified in-app (Didit) has a reviewed selfie but may have no
    // licence photos on file — that counts too.
    const idVerified = areDocumentsVerified(profile)
        || (profile?.verification?.status === 'verified' && !!profile?.selfie?.reviewedAt);
    const labelReady = idVerified && !!profile?.workerId;
    const handlePrintLabel = async () => {
        if (printingLabelRef.current) return;
        if (!labelReady) {
            Alert.alert(
                'Not ready to print',
                idVerified
                    ? 'Your worker ID is still being issued. Try again in a moment.'
                    : 'You can print your worker ID label once FoodyzzHQ has verified your driver license, proof of address and selfie.',
            );
            return;
        }
        printingLabelRef.current = true;
        setPrintingLabel(true);
        try {
            // The header already resolved this selfie's URL — reuse it.
            const url = selfieUrl ?? await documentImageUrl(profile.selfie.frontPath);
            const selfieDataUrl = await imageAsDataUrl(url);
            await Print.printAsync({
                html: buildWorkerLabelHtml({
                    name: profile?.name || '',
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
            Alert.alert('Could not print', friendlyError(e, 'The label did not print. Check the printer is on and connected, then try again.'));
        } finally {
            printingLabelRef.current = false;
            setPrintingLabel(false);
        }
    };

    const handleSaveCard = async () => {
        if (!cardName.trim() || !cardComplete) {
            Alert.alert('Incomplete', 'Please enter cardholder name and complete card details.');
            return;
        }
        setIsSavingCard(true);
        try {
            const { paymentMethod, error } = await createPaymentMethod({
                paymentMethodType: 'Card',
                paymentMethodData: { billingDetails: { name: cardName.trim() } },
            });
            if (error || !paymentMethod) {
                Alert.alert('Card Error', friendlyPaymentError(error, 'Could not process those card details. Check them and try again.'));
                return;
            }
            await getFunctionsInstance().httpsCallable('saveCustomerBillingCard')({
                paymentMethodId: paymentMethod.id,
                cardName: cardName.trim(),
                customerPhone: user!.phoneNumber,
            });
            setShowCardEntry(false);
            setCardName('');
            setCardComplete(false);
            Alert.alert('Card Saved', 'Your card has been securely saved for future orders.');
        } catch (err: any) {
            Alert.alert('Save Failed', friendlyError(err, 'Could not save your card. Please try again.'));
        } finally {
            setIsSavingCard(false);
        }
    };

    // The card backs more than checkout — the deposit hold and rent-to-buy installments
    // fall back to it — so the server refuses while a rental is live and says why. The
    // confirm step is here rather than server-side because removal is only destructive
    // from the customer's point of view: nothing is charged either way.
    const handleRemoveCard = () => {
        Alert.alert(
            'Remove Card?',
            `Your saved ${profile?.billingCardBrand || 'card'} ending ${profile?.billingCardLast4} will be deleted. You'll need to enter card details again at your next checkout.`,
            [
                { text: 'Keep Card', style: 'cancel' },
                {
                    text: 'Remove',
                    style: 'destructive',
                    onPress: async () => {
                        setIsRemovingCard(true);
                        try {
                            await getFunctionsInstance().httpsCallable('removeCustomerBillingCard')({
                                customerPhone: user!.phoneNumber,
                            });
                            // The card fields clear through the users/{phone} listener in
                            // UserProfileContext, so there is no local state to reset.
                            Alert.alert('Card Removed', 'Your saved card has been deleted.');
                        } catch (err: any) {
                            Alert.alert('Could Not Remove Card', friendlyError(err, 'Could not remove your card. Please try again.'));
                        } finally {
                            setIsRemovingCard(false);
                        }
                    },
                },
            ],
        );
    };

    const handleSaveProfile = async () => {
        if (!editName || !editEmail || !editAddress) {
            Alert.alert('Error', 'Required fields: Name, Email, and Address.');
            return;
        }
        // Only a CHANGED address needs a code — an address from before this existed
        // stays as it is rather than locking the customer out of their own profile.
        if (normalizeEmail(editEmail) !== normalizeEmail(profile?.email) && !emailConfirmed) {
            Alert.alert('Confirm your email', 'Send yourself the code and enter it before saving the new address.');
            return;
        }
        // Optional here, but if one is entered it has to be a real one.
        if (editCompletionId && !isValidCompletionId(editCompletionId)) {
            Alert.alert('Check your Completion ID', "It's numbers with one '-' in the middle, up to 15 characters.");
            return;
        }

        const apiKey = globalConfig?.apiKeys?.googleMap;
        let lat: number | null = null;
        let lng: number | null = null;

        if (apiKey) {
            setValidatingAddress(true);
            try {
                const coords = await geocodeAddress(editAddress, apiKey);
                if (!coords) {
                    Alert.alert(
                        'Address Not Found',
                        "We couldn't verify that address. Please enter a full street address including city and state.",
                    );
                    return;
                }
                lat = coords.lat;
                lng = coords.lng;
            } finally {
                setValidatingAddress(false);
            }
        }

        try {
            await db.collection('users').doc(user!.phoneNumber!).update({
                name: editName,
                email: editEmail,
                address: editAddress,
                zipCode: extractZip(editAddress) || null,
                bikeSafetyCompletionId: editCompletionId || null,
                ...(lat !== null && lng !== null ? { lat, lng } : {}),
            });
            setIsEditing(false);
        } catch (error) {
            Alert.alert('Update Failed', 'Could not sync profile changes.');
        }
    };

    const handleSignOut = async () => {
        try {
            await signOutClean();
        } catch (error) {
            Alert.alert("Error", "Could not sign out of the session.");
        }
    };

    const handleToggleSoundEnabled = async (val: boolean) => {
        setSoundEnabled(val);
        await AsyncStorage.setItem('@notification_sound_enabled', val ? 'true' : 'false');
        // Mirror to the user doc so the backend can mute background/killed pushes
        // (it can't read on-device AsyncStorage). Best-effort.
        try {
            if (user?.phoneNumber) {
                await db.collection('users').doc(user.phoneNumber).set({ notificationSoundEnabled: val }, { merge: true });
            }
        } catch (e) {
            console.warn('Failed to sync sound preference to Firestore:', e);
        }
    };

    const handleDeleteAccount = async () => {
        try {
            // Archive to archivedUsers collection
            await db.collection('archivedUsers').doc(user!.phoneNumber!).set({
                ...profile,
                archivedAt: new Date().toISOString()
            });
            // Delete from users
            await db.collection('users').doc(user!.phoneNumber!).delete();
            // Sign out (+ reset Firestore so a fresh sign-in starts clean)
            await signOutClean();
        } catch (error) {
            // This used to swallow the cause behind one fixed sentence, which is why
            // a rules rejection on the archive write looked like an unexplained
            // failure. Keep the reason.
            logHandledError('deleteAccount', error);
            Alert.alert('Could Not Delete Profile', friendlyError(error, 'We could not delete your profile. Please try again, or message support.'));
        }
    };

    // What the native header used to render. Nothing here is a UIKit bar item, so no
    // capsule is drawn behind the Edit button. insets.top stands in for the status-bar
    // space the native header reserved.
    const header = (
        <View style={{ paddingTop: insets.top }} className="bg-white">
            <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
                <Text className="text-xl font-black text-black uppercase tracking-tighter leading-none">My.<Text className="text-brand-green-dark">Profile</Text></Text>
                {!isEditing && (
                    <TouchableOpacity
                        onPress={startEditing}
                        className="bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 flex-row items-center gap-2"
                    >
                        <Edit2 size={12} color={COLORS.brand.greenDark} />
                        <Text className="text-indigo-700 font-black text-[10px] uppercase">Edit</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    if (loading) {
        return (
            <View className="flex-1 bg-white">
                {header}
                <View className="flex-1 justify-center items-center">
                    <ActivityIndicator color={COLORS.brand.greenDark} />
                </View>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white">
            {header}
            <ScrollView ref={scrollRef} className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
                {/* Profile Card */}
                <View className="bg-white border-2 border-black rounded-[32px] p-6 shadow-brutalist mb-6">
                    <View className="flex-row items-center gap-4 mb-6">
                        {/* Selfie box — the rider's selfie once taken (it goes on the
                            worker ID). Tapping opens the front camera. */}
                        <TouchableOpacity
                            onPress={handleTakeSelfie}
                            accessibilityRole="button"
                            accessibilityLabel={selfieUrl || draftSelfie ? 'Retake selfie' : 'Take selfie'}
                            className="w-16 h-16 bg-slate-100 rounded-2xl items-center justify-center border-2 border-black overflow-hidden"
                        >
                            {draftSelfie || selfieUrl ? (
                                <Image source={{ uri: (draftSelfie || selfieUrl)! }} className="w-full h-full" resizeMode="cover" />
                            ) : (
                                <>
                                    <Camera size={20} color="#64748b" />
                                    <Text className="text-[8px] font-black uppercase text-slate-500 tracking-widest mt-1">Selfie</Text>
                                </>
                            )}
                        </TouchableOpacity>
                        <View className="flex-1">
                            <Text className="text-lg font-black text-black uppercase">{profile?.name || 'Incomplete Profile'}</Text>
                            {/* Phone, then the worker ID once the server has issued it. */}
                            <Text className="text-[10px] font-mono text-slate-400 font-bold">
                                {user?.phoneNumber}
                                {profile?.workerId ? <Text className="text-slate-600 font-black"> {profile.workerId}</Text> : null}
                            </Text>
                        </View>
                        {/* Print the worker ID label — greyed until the documents are verified. */}
                        <TouchableOpacity
                            onPress={handlePrintLabel}
                            disabled={printingLabel}
                            accessibilityRole="button"
                            accessibilityLabel="Print worker ID label"
                            className={`w-10 h-10 rounded-xl border-2 items-center justify-center ${
                                labelReady ? 'border-black bg-white' : 'border-slate-200 bg-slate-50'
                            }`}
                        >
                            {printingLabel
                                ? <ActivityIndicator size="small" color="#000000" />
                                : <Printer size={18} color={labelReady ? '#000000' : '#cbd5e1'} />}
                        </TouchableOpacity>
                    </View>

                    <View className="space-y-4">
                        <View className="flex-row items-center gap-3">
                            <Mail size={16} color="#94a3b8" />
                            <Text className="text-xs font-bold text-slate-600">{profile?.email || 'No email set'}</Text>
                        </View>
                        <View className="flex-row items-center gap-3">
                            <ShieldCheck size={16} color="#94a3b8" />
                            <Text className="text-xs font-bold text-slate-600 flex-1">
                                {profile?.bikeSafetyCompletionId
                                    ? <>Safety course ID <Text className="font-mono font-black">{profile.bikeSafetyCompletionId}</Text></>
                                    : 'No safety course Completion ID'}
                            </Text>
                        </View>
                        <View className="flex-row items-start gap-3">
                            <MapPin size={16} color="#94a3b8" className="mt-0.5" />
                            <Text className="text-xs font-bold text-slate-600 flex-1 leading-relaxed">{profile?.address || 'No address set'}</Text>
                        </View>
                    </View>
                </View>

                {/* Verification for Rent / Rent to Buy — live status from the server. */}
                {(() => {
                    const vs = profile?.verification?.status;
                    const label = vs === 'verified' ? 'Verified' : vs === 'in_review' ? 'In review' : 'Action needed';
                    const tone = vs === 'verified' ? 'text-emerald-600' : vs === 'in_review' ? 'text-amber-600' : 'text-red-600';
                    return (
                        <TouchableOpacity
                            onPress={() => navigation.navigate('Verification')}
                            className="bg-white border-2 border-black rounded-3xl p-5 mb-6 flex-row items-center"
                            accessibilityRole="button"
                            accessibilityLabel="Identity verification"
                        >
                            <ShieldCheck size={22} color="#000000" />
                            <View className="ml-3 flex-1">
                                <Text className="text-sm font-black text-black uppercase">Identity verification</Text>
                                <Text className="text-[10px] font-bold text-slate-500 mt-0.5">
                                    ID, address and sign-up location — needed to Rent or Rent to Buy
                                </Text>
                            </View>
                            <Text className={`text-[10px] font-black uppercase mr-1 ${tone}`}>{label}</Text>
                            <ChevronRight size={16} color="#94a3b8" />
                        </TouchableOpacity>
                    );
                })()}

                {/* Driver license, proof of address and selfie — scan ahead of time to
                    skip the ID check at rental. */}
                <View className="px-5 mb-5" onLayout={(e) => { docsCardY.current = e.nativeEvent.layout.y; }}>
                    <IdentityDocumentsCard
                        profile={profile}
                        incomingSelfie={pendingSelfie}
                        onSelfieDraftChange={(uri) => {
                            setDraftSelfie(uri);
                            // Discarded or submitted — don't re-apply it if the card remounts.
                            if (!uri) setPendingSelfie(null);
                        }}
                    />
                </View>

                {/* Saved Payment Card */}
                <View className="bg-slate-50 border-2 border-black rounded-3xl p-5 mb-4">
                    <Text className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest mb-3">Payment Method</Text>

                    {profile?.billingCardLast4 && !showCardEntry ? (
                        <View>
                            <View className="flex-row items-center justify-between">
                                <View className="flex-row items-center gap-3">
                                    <View className="bg-emerald-50 border border-emerald-200 p-2 rounded-xl">
                                        <CreditCard size={18} color="#10b981" />
                                    </View>
                                    <View>
                                        <Text className="text-xs font-black text-black uppercase capitalize">
                                            {profile.billingCardBrand} ••••{profile.billingCardLast4}
                                        </Text>
                                        <Text className="text-[9px] text-emerald-600 font-black uppercase font-mono">Saved · Expires {profile.billingCardExpMonth}/{profile.billingCardExpYear}</Text>
                                    </View>
                                </View>
                                <View className="flex-row items-center gap-2">
                                    <TouchableOpacity
                                        onPress={() => setShowCardEntry(true)}
                                        disabled={isRemovingCard}
                                        className="bg-slate-200 border border-slate-300 px-3 py-1.5 rounded-xl"
                                    >
                                        <Text className="text-slate-700 font-black text-[10px] uppercase">Change</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={handleRemoveCard}
                                        disabled={isRemovingCard}
                                        className={`flex-row items-center gap-1 border px-3 py-1.5 rounded-xl ${isRemovingCard ? 'bg-slate-100 border-slate-200' : 'bg-red-50 border-red-200'}`}
                                    >
                                        {/* Kept FLAT — no <>…</> here. NativeWind v2 polyfills `gap-1`
                                            by cloning every direct child with an injected `style`
                                            (withStyledChildren), and a React.Fragment accepts only
                                            `key`/`children`, so wrapping these two in a fragment logged
                                            "Invalid prop `style` supplied to `React.Fragment`" on every
                                            render of this screen. As direct children they also finally
                                            get the gap-1 spacing the class was asking for. */}
                                        {isRemovingCard
                                            ? <ActivityIndicator size="small" color="#94a3b8" />
                                            : <Trash2 size={11} color="#dc2626" />}
                                        {!isRemovingCard && (
                                            <Text className="text-red-600 font-black text-[10px] uppercase">Remove</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                            <Text className="text-[9px] text-slate-400 font-medium mt-3 leading-relaxed">
                                This card will be used automatically at checkout. No need to re-enter details.
                            </Text>
                        </View>
                    ) : (
                        <View>
                            {!showCardEntry ? (
                                <TouchableOpacity
                                    onPress={() => setShowCardEntry(true)}
                                    className="flex-row items-center gap-3 bg-white border-2 border-dashed border-slate-300 rounded-2xl p-4"
                                >
                                    <CreditCard size={18} color="#94a3b8" />
                                    <Text className="text-slate-400 font-black text-xs uppercase">Add a Payment Card</Text>
                                </TouchableOpacity>
                            ) : (
                                <View>
                                    <TextInput
                                        value={cardName}
                                        onChangeText={setCardName}
                                        placeholder="Name on Card"
                                        placeholderTextColor="#94a3b8"
                                        autoCapitalize="words"
                                        className="bg-white border-2 border-slate-200 rounded-xl p-3 text-black text-xs font-bold mb-3"
                                    />
                                    <CardField
                                        postalCodeEnabled={true}
                                        onCardChange={(details) => setCardComplete(details.complete)}
                                        style={{ width: '100%', height: 50, marginBottom: 12 }}
                                        cardStyle={{
                                            backgroundColor: '#f8fafc',
                                            textColor: '#0f172a',
                                            placeholderColor: '#94a3b8',
                                            borderWidth: 1,
                                            borderColor: '#e2e8f0',
                                            borderRadius: 8,
                                        }}
                                    />
                                    <View className="flex-row gap-2">
                                        <TouchableOpacity
                                            onPress={() => { setShowCardEntry(false); setCardName(''); setCardComplete(false); }}
                                            className="flex-1 py-3 bg-slate-100 rounded-xl border border-slate-200 items-center"
                                        >
                                            <Text className="text-slate-600 font-black text-[10px] uppercase">Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={handleSaveCard}
                                            disabled={isSavingCard || !cardName.trim() || !cardComplete}
                                            className={`flex-[2] py-3 rounded-xl items-center border-2 border-black ${isSavingCard || !cardName.trim() || !cardComplete ? 'bg-slate-300' : 'bg-black'}`}
                                        >
                                            {isSavingCard ? (
                                                <ActivityIndicator color="white" size="small" />
                                            ) : (
                                                <Text className="text-white font-black text-[10px] uppercase">Save Card</Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>
                    )}
                </View>

                {/* Support Chat */}
                <TouchableOpacity
                    onPress={() => navigation.navigate('Support')}
                    className="bg-white border-2 border-slate-100 rounded-3xl p-5 mb-4 shadow-sm flex-row justify-between items-center"
                >
                    <View className="flex-row items-center gap-3">
                        <MessageSquare size={20} color={COLORS.brand.green} />
                        <View>
                            <Text className="text-xs font-black uppercase">Customer Support Chat</Text>
                            <Text className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Live Admin Desk</Text>
                        </View>
                    </View>
                    <ChevronRight size={18} color="black" />
                </TouchableOpacity>

                {/* Notification Sound */}
                <View className="bg-slate-50 border-2 border-black rounded-3xl p-5 mb-4">
                    <View className="flex-row items-center gap-2 mb-3">
                        <Bell size={16} color={COLORS.brand.greenDark} />
                        <Text className="text-[10px] font-mono font-black text-slate-400 uppercase tracking-widest">Notification Sound</Text>
                    </View>

                    <View className="flex-row justify-between items-center mb-3 pb-3 border-b border-slate-200">
                        <View className="flex-1 pr-4">
                            <Text className="text-xs font-black uppercase">Sound Alerts</Text>
                            <Text className="text-[9px] text-slate-400 font-bold uppercase leading-tight mt-0.5">Play sound for order updates</Text>
                        </View>
                        <Switch
                            value={soundEnabled}
                            onValueChange={handleToggleSoundEnabled}
                            trackColor={{ false: '#cbd5e1', true: '#507425' }}
                            thumbColor={soundEnabled ? '#ffffff' : '#94a3b8'}
                        />
                    </View>

                    <View className="space-y-2">
                        <View className="flex-row items-center gap-2">
                            <Volume2 size={12} color="#94a3b8" />
                            <Text className="text-[9px] text-slate-400 font-bold uppercase leading-tight flex-1">Confirmation → "Confirmation" tone</Text>
                        </View>
                        <View className="flex-row items-center gap-2">
                            <Volume2 size={12} color="#94a3b8" />
                            <Text className="text-[9px] text-slate-400 font-bold uppercase leading-tight flex-1">Updates & Declines → "Quick Tone"</Text>
                        </View>
                    </View>
                </View>

                {/* Sign Out Section */}
                <TouchableOpacity
                    onPress={handleSignOut}
                    className="bg-white border-2 border-slate-100 rounded-3xl p-5 mb-4 shadow-sm flex-row justify-between items-center"
                >
                    <View className="flex-row items-center gap-3">
                        <LogOut size={20} color={COLORS.brand.greenDark} />
                        <View>
                            <Text className="text-xs font-black uppercase">Secure Sign Out</Text>
                            <Text className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">End Current Session</Text>
                        </View>
                    </View>
                    <ChevronRight size={18} color="black" />
                </TouchableOpacity>

                {/* Danger Zone */}
                <View className="bg-rose-50 border-2 border-rose-100 rounded-3xl p-5 mb-4">
                    <View className="flex-row items-center gap-2 mb-2">
                        <AlertTriangle size={16} color={COLORS.status.cancelled} />
                        <Text className="text-xs font-black uppercase text-rose-600">Delete Profile Block</Text>
                    </View>
                    <Text className="text-[9px] text-rose-500 font-bold uppercase leading-relaxed mb-4">
                        Deleting your account will wipe your Profile.
                    </Text>
                    <TouchableOpacity
                        onPress={() => setShowDeleteConfirm(true)}
                        className="bg-rose-600 py-3 rounded-xl items-center border-2 border-black shadow-sm"
                    >
                        <Text className="text-white text-center font-black text-xs uppercase">Archive & Delete My Profile</Text>
                    </TouchableOpacity>
                </View>

                {/* Legal / support links + app version */}
                <View className="items-center mb-12 mt-1">
                    <View className="flex-row items-center justify-center flex-wrap gap-x-5 gap-y-2">
                        {globalConfig?.legal?.privacy ? (
                            <TouchableOpacity onPress={() => Linking.openURL(globalConfig.legal!.privacy!).catch(() => Alert.alert('Error', 'Could not open Privacy Policy.'))}>
                                <Text className="text-[10px] font-black uppercase text-slate-400 underline tracking-widest">Privacy</Text>
                            </TouchableOpacity>
                        ) : null}
                        {globalConfig?.faq ? (
                            <TouchableOpacity onPress={() => Linking.openURL(globalConfig.faq!).catch(() => Alert.alert('Error', 'Could not open FAQs.'))}>
                                <Text className="text-[10px] font-black uppercase text-slate-400 underline tracking-widest">FAQs</Text>
                            </TouchableOpacity>
                        ) : null}
                        {globalConfig?.contactus ? (
                            <TouchableOpacity onPress={() => Linking.openURL(globalConfig.contactus!).catch(() => Alert.alert('Error', 'Could not open Contact Us.'))}>
                                <Text className="text-[10px] font-black uppercase text-slate-400 underline tracking-widest">Contact Us</Text>
                            </TouchableOpacity>
                        ) : null}
                    </View>
                    {Constants.expoConfig?.version ? (
                        <Text className="text-[9px] font-bold uppercase text-slate-400 tracking-widest mt-3">Version {Constants.expoConfig.version}</Text>
                    ) : null}
                </View>
            </ScrollView>

            {/* Edit Modal */}
            <Modal visible={isEditing} animationType="slide" transparent={true}>
                {/* An Android Modal is its OWN window, so it does NOT inherit the
                    activity's adjustResize or its KeyboardAvoidingView — nothing there lifts
                    the sheet clear of it (iOS modals render in-window, which is why this only
                    ever showed on Android). The avoidance has to live INSIDE the Modal. */}
                <KeyboardAvoidingView behavior="padding" className="flex-1 bg-black/60 justify-end">
                    <View className="bg-white rounded-t-[44px] border-t-4 border-black p-6 h-[85%]" style={{ paddingBottom: bottom + 24 }}>
                        <View className="flex-row justify-between items-center mb-6">
                            <Text className="text-xl font-black uppercase">Edit Details</Text>
                            <TouchableOpacity onPress={() => setIsEditing(false)} className="p-2 bg-slate-100 rounded-full">
                                <X size={20} color="black" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" className="space-y-5">
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Full Name</Text>
                                <TextInput
                                    value={editName} onChangeText={setEditName}
                                    className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black"
                                />
                            </View>
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Email Address</Text>
                                <EmailConfirmField
                                    value={editEmail}
                                    onChangeText={setEditEmail}
                                    profile={profile}
                                    onConfirmedChange={setEmailConfirmed}
                                    inputClassName="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black font-mono"
                                />
                            </View>
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Street Address & Zip</Text>
                                <AddressAutocomplete
                                    value={editAddress}
                                    onSelect={setEditAddress}
                                    apiKey={globalConfig?.apiKeys?.googleMap}
                                    inputClassName="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black"
                                />
                            </View>
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Bike Safety Course Completion ID</Text>
                                <TextInput
                                    value={editCompletionId}
                                    onChangeText={(t) => setEditCompletionId(sanitizeCompletionId(t))}
                                    placeholder="e.g. 1234567-89012"
                                    placeholderTextColor="#94a3b8"
                                    maxLength={COMPLETION_ID_MAX_LENGTH}
                                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'phone-pad'}
                                    autoCorrect={false}
                                    className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black font-mono"
                                />
                                <TouchableOpacity onPress={() => Linking.openURL(DELIVER_SAFELY_URL)} className="mt-2 ml-1">
                                    <Text className="text-[10px] font-black text-brand-green-dark underline">
                                        Not done the course yet? nyc.gov/DeliverSafely
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            <TouchableOpacity
                                onPress={handleSaveProfile}
                                disabled={validatingAddress}
                                className="bg-black py-5 rounded-3xl items-center shadow-brutalist border-2 border-black mt-4"
                            >
                                {validatingAddress ? (
                                    <ActivityIndicator color="white" />
                                ) : (
                                    <Text className="text-white font-black uppercase text-base">Save Changes</Text>
                                )}
                            </TouchableOpacity>
                            <View className="h-12" />
                        </ScrollView>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Delete Confirm Modal */}
            <Modal visible={showDeleteConfirm} transparent={true} animationType="fade">
                <View className="flex-1 bg-black/80 justify-center items-center p-6">
                    <View className="bg-white rounded-[40px] p-8 w-full border-4 border-black shadow-brutalist">
                        <View className="w-16 h-16 bg-rose-50 rounded-full items-center justify-center mx-auto mb-4 border-2 border-rose-100">
                            <AlertTriangle size={32} color={COLORS.status.cancelled} />
                        </View>
                        <Text className="text-center font-black text-xl uppercase mb-2">Delete Profile?</Text>
                        <Text className="text-center text-slate-500 font-bold text-xs leading-relaxed mb-8">
                            Are you absolutely sure? This will wipe your session and archive your history.
                        </Text>
                        <View className="flex-row gap-3">
                            <TouchableOpacity
                                onPress={() => setShowDeleteConfirm(false)}
                                className="flex-1 py-4 bg-slate-100 rounded-2xl border-2 border-slate-200 items-center"
                            >
                                <Text className="font-black uppercase text-xs">Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleDeleteAccount}
                                className="flex-1 py-4 bg-rose-600 rounded-2xl border-2 border-black shadow-sm items-center"
                            >
                                <Text className="text-white text-center font-black text-xs uppercase">Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
