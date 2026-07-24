import React, { useState, useEffect, useLayoutEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Switch, Modal, ActivityIndicator, Linking } from 'react-native';
import { User, Mail, MapPin, MessageSquare, CreditCard, AlertTriangle, ChevronRight, Edit2, X, Trash2, ShieldCheck, LogOut, Bell, Volume2 } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { previewSound } from '../services/soundPlayer';
import { COLORS, LAYOUT } from '../theme';
import { db, subscribeToGlobalConfig, getFunctionsInstance, signOutClean } from '../services/firebase';
import { extractZip, geocodeAddress } from '../services/geo';
import { GlobalConfig } from '../types';
import authNative from '@react-native-firebase/auth';
import { useNavigation } from '@react-navigation/native';
import { useStripe, CardField } from '@stripe/stripe-react-native';
import AddressAutocomplete from '../components/AddressAutocomplete';
import IdentityDocumentsCard from '../components/IdentityDocumentsCard';
import { useUserProfile } from '../context/UserProfileContext';

export default function ProfileScreen() {
    const navigation = useNavigation<any>();
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
    const [editAddress, setEditAddress] = useState('');

    // Card management
    const { createPaymentMethod } = useStripe();
    const [cardName, setCardName] = useState('');
    const [cardComplete, setCardComplete] = useState(false);
    const [isSavingCard, setIsSavingCard] = useState(false);
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

    useLayoutEffect(() => {
        navigation.setOptions({
            headerShown: true,
            headerTitle: () => (
                <View>
                    <Text className="text-xl font-black text-black uppercase tracking-tighter leading-none">My.<Text className="text-brand-green-dark">Profile</Text></Text>
                </View>
            ),
            headerTitleAlign: 'left',
            headerRight: () => !isEditing ? (
                <TouchableOpacity
                    onPress={() => setIsEditing(true)}
                    className="bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 flex-row items-center gap-2 mr-4"
                >
                    <Edit2 size={12} color={COLORS.brand.greenDark} />
                    <Text className="text-indigo-700 font-black text-[10px] uppercase">Edit</Text>
                </TouchableOpacity>
            ) : null,
            headerStyle: { elevation: 0, shadowOpacity: 0, borderBottomWidth: 0, backgroundColor: 'white' },
        });
    }, [navigation, isEditing]);

    // Seed the edit-form fields whenever the shared profile updates. Mirrors the old
    // per-snapshot behavior (the listener that used to live here set these on every
    // snapshot); the users/{phone} subscription itself now lives in UserProfileContext.
    useEffect(() => {
        if (profile) {
            setEditName(profile.name || '');
            setEditEmail(profile.email || '');
            setEditAddress(profile.address || '');
        }
    }, [profile]);

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
                Alert.alert('Card Error', error?.message || 'Could not process card details.');
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
            Alert.alert('Save Failed', err.message || 'Could not save card.');
        } finally {
            setIsSavingCard(false);
        }
    };

    const handleSaveProfile = async () => {
        if (!editName || !editEmail || !editAddress) {
            Alert.alert('Error', 'Required fields: Name, Email, and Address.');
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
            Alert.alert("Error", "Archive sequence failed.");
        }
    };

    if (loading) {
        return (
            <View className="flex-1 justify-center items-center bg-white">
                <ActivityIndicator color={COLORS.brand.greenDark} />
            </View>
        );
    }

    return (
        <View className="flex-1 bg-white">
            <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false}>
                {/* Profile Card */}
                <View className="bg-white border-2 border-black rounded-[32px] p-6 shadow-brutalist mb-6">
                    <View className="flex-row items-center gap-4 mb-6">
                        <View className="w-16 h-16 bg-indigo-600 rounded-2xl items-center justify-center border-2 border-black">
                            <Text className="text-white text-2xl font-black">{profile?.name?.slice(0, 2).toUpperCase() || '??'}</Text>
                        </View>
                        <View>
                            <Text className="text-lg font-black text-black uppercase">{profile?.name || 'Incomplete Profile'}</Text>
                            <Text className="text-[10px] font-mono text-slate-400 font-bold">{user?.phoneNumber}</Text>
                        </View>
                    </View>

                    <View className="space-y-4">
                        <View className="flex-row items-center gap-3">
                            <Mail size={16} color="#94a3b8" />
                            <Text className="text-xs font-bold text-slate-600">{profile?.email || 'No email set'}</Text>
                        </View>
                        <View className="flex-row items-start gap-3">
                            <MapPin size={16} color="#94a3b8" className="mt-0.5" />
                            <Text className="text-xs font-bold text-slate-600 flex-1 leading-relaxed">{profile?.address || 'No address set'}</Text>
                        </View>
                    </View>
                </View>

                {/* Driver license — scan ahead of time to skip the ID check at rental. */}
                <View className="px-5 mb-5">
                    <IdentityDocumentsCard profile={profile} />
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
                                <TouchableOpacity
                                    onPress={() => setShowCardEntry(true)}
                                    className="bg-slate-200 border border-slate-300 px-3 py-1.5 rounded-xl"
                                >
                                    <Text className="text-slate-700 font-black text-[10px] uppercase">Change</Text>
                                </TouchableOpacity>
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
                <View className="flex-1 bg-black/60 justify-end">
                    <View className="bg-white rounded-t-[44px] border-t-4 border-black p-6 h-[85%]">
                        <View className="flex-row justify-between items-center mb-6">
                            <Text className="text-xl font-black uppercase">Edit Details</Text>
                            <TouchableOpacity onPress={() => setIsEditing(false)} className="p-2 bg-slate-100 rounded-full">
                                <X size={20} color="black" />
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} className="space-y-5">
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Full Name</Text>
                                <TextInput
                                    value={editName} onChangeText={setEditName}
                                    className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black"
                                />
                            </View>
                            <View>
                                <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Email Address</Text>
                                <TextInput
                                    value={editEmail} onChangeText={setEditEmail} keyboardType="email-address"
                                    className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black font-mono"
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
                </View>
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
