import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Alert, Switch, Modal, ActivityIndicator, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { Building, Mail, MapPin, Clock, DollarSign, CreditCard, Edit2, X, AlertTriangle, ChevronRight, LogOut, Trash2, MessageSquare, Bell, Volume2, Truck, Layers, Star, CheckCircle, Power, Check, ArrowRight, ArrowLeft, Save } from 'lucide-react-native';
import { previewSound, stopCurrentSound } from '../services/soundPlayer';
import { COLORS, LAYOUT } from '../theme';
import { db, auth as authNative, signOutClean, getActiveProviderId, listMyStores } from '../services/firebase'; // Import native auth
import { useActiveProvider, useGlobalConfig } from '../hooks';
import { useNavigation } from '@react-navigation/native';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { useActiveStore } from '../contexts/ActiveStoreContext';
import { extractZipFromAddress } from '../utils/address';


// Verifies a typed address with the Google Geocoding API. Returns coordinates on
// success, null if the address can't be resolved. Used to block saving an invalid
// HQ address on edit (onboarding already validates; edit previously did not, so a
// provider could overwrite a good address with garbage and break delivery-radius
// distance math, which reads providers.lat/lng).
async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status === 'OK' && loc) return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch {
    return null;
  }
}

// ─── Google Places autocomplete helpers ───────────────────────────────────────
// Same pattern the onboarding wizard uses so the edit flow steers providers to a
// real, geocodable address instead of accepting free-form text.

type PlacePrediction = { description: string; place_id: string };

async function fetchPlaceSuggestions(input: string, apiKey: string): Promise<PlacePrediction[]> {
  if (!input.trim() || input.trim().length < 3) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`
      + `?input=${encodeURIComponent(input.trim())}`
      + `&types=address`
      + `&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
      return (data.predictions || []).map((p: any) => ({
        description: p.description,
        place_id: p.place_id,
      }));
    }
    return [];
  } catch (e) {
    console.warn('fetchPlaceSuggestions error:', e);
    return [];
  }
}

async function fetchPlaceDetails(placeId: string, apiKey: string): Promise<string> {
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json`
      + `?place_id=${encodeURIComponent(placeId)}`
      + `&fields=formatted_address`
      + `&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    return data?.result?.formatted_address || '';
  } catch (e) {
    console.warn('fetchPlaceDetails error:', e);
    return '';
  }
}

const SOUND_OPTIONS = [
  { key: 'bell',         label: 'Bell' },
  { key: 'confirmation', label: 'Confirmation' },
  { key: 'doorbell',     label: 'Doorbell' },
  { key: 'happybell',    label: 'Happy Bell' },
  { key: 'officering',   label: 'Office Ring' },
  { key: 'oldphone',     label: 'Old Phone' },
  { key: 'quicktone',    label: 'Quick Tone' },
  { key: 'vintage',      label: 'Vintage' },
];

export default function AccountScreen() {
  const { top } = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const user = authNative().currentUser; // Use native auth instance
  const { profile, loading } = useActiveProvider();
  const config = useGlobalConfig();
  const deliveryFee = config?.deliveryFee?.pickupDelivery ?? 9.99;
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const { switchStore } = useActiveStore();
  const [showStoreSwitcher, setShowStoreSwitcher] = useState(false);
  const [ownedStores, setOwnedStores] = useState<any[]>([]);

  // Notification sound preferences
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [selectedSound, setSelectedSound] = useState('bell');
  const [showSoundPicker, setShowSoundPicker] = useState(false);
  const [previewingSound, setPreviewingSound] = useState<string | null>(null);

  // Form states
  const [editBusName, setEditBusName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  // editAddress holds the *confirmed* address (parity with onboarding's
  // selectedAddress): when set, the field is locked and shows a "confirmed" chip.
  // addressQuery is the live typing buffer used only while the provider is
  // changing the address. Empty editAddress => we're in edit/typing mode.
  const [editAddress, setEditAddress] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<PlacePrediction[]>([]);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const addressDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Production-safety for the Places-backed field (parity with the customer app's
  // AddressAutocomplete): cancel the debounce on unmount and discard stale/
  // out-of-order fetch responses so we never setState on an unmounted component.
  const addressMountedRef = useRef(true);
  const addressReqIdRef = useRef(0);
  // Holds the sound-preview reset timer so we can clear it on unmount and never
  // setState (setPreviewingSound) after the component is gone.
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [validatingAddress, setValidatingAddress] = useState(false);
  const [editSlotCapacity, setEditSlotCapacity] = useState('5');

  // Services state. Bike rates are global (apiConfig/logistics), not per location.
  const [editTurnaroundNormal, setEditTurnaroundNormal] = useState('');   // whole days
  const [editTurnaroundPriority, setEditTurnaroundPriority] = useState(''); // whole days
  const [editChargesPriorityFee, setEditChargesPriorityFee] = useState(false);
  const [editPriorityPrice, setEditPriorityPrice] = useState('');
  const [editChargesSalesTax, setEditChargesSalesTax] = useState(false);
  const [editSalesTaxRate, setEditSalesTaxRate] = useState(''); // percent string, e.g. "8.625"
  const [editPickupEnabled, setEditPickupEnabled] = useState(false);

  const [editHours, setEditOperatingHours] = useState({
    monday: "08:00 - 22:00",
    tuesday: "08:00 - 22:00",
    wednesday: "08:00 - 22:00",
    thursday: "08:00 - 22:00",
    friday: "08:00 - 23:00",
    saturday: "07:00 - 23:00",
    sunday: "08:00 - 21:00"
  });

  // The active store doc is provided live by useActiveProvider(); mirror it into
  // the edit-form fields whenever it changes (same population the listener did).
  useEffect(() => {
    if (!profile) return;
    const data = profile;
    setEditBusName(data.businessName || '');
    setEditEmail(data.email || '');
    setEditAddress(data.address || '');
    if (data.slotCapacity) setEditSlotCapacity(String(data.slotCapacity));
    if (data.businessHours) setEditOperatingHours(data.businessHours);


    if (data.turnaroundNormal != null) setEditTurnaroundNormal(String(data.turnaroundNormal).replace(/\D/g, ''));
    if (data.turnaroundPriority != null) setEditTurnaroundPriority(String(data.turnaroundPriority).replace(/\D/g, ''));
    setEditChargesPriorityFee(data.chargesPriorityFee === true);
    if (data.priorityPrice != null) setEditPriorityPrice(String(data.priorityPrice));
    setEditChargesSalesTax(data.chargesSalesTax === true);
    // salesTaxRate is stored as a decimal (0.08625); show it as a percent (8.625).
    if (data.salesTaxRate != null && data.salesTaxRate > 0) setEditSalesTaxRate(String(+(data.salesTaxRate * 100).toFixed(4)));
    if (data.pickupEnabled != null) setEditPickupEnabled(data.pickupEnabled);


  }, [profile]);

  // Tear down the address autocomplete's timer/in-flight requests on unmount.
  useEffect(() => {
    return () => {
      addressMountedRef.current = false;
      if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
      if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const loadSoundPrefs = async () => {
      const enabled = await ReactNativeAsyncStorage.getItem('@notification_sound_enabled');
      const selection = await ReactNativeAsyncStorage.getItem('@notification_sound_selection');
      if (enabled !== null) setSoundEnabled(enabled !== 'false');
      if (selection) setSelectedSound(selection);
    };
    loadSoundPrefs();
  }, []);

  // ─── Address autocomplete (mirrors onboarding) ────────────────────────────
  const handleAddressInputChange = (text: string) => {
    setAddressQuery(text);
    setEditAddress('');
    const apiKey = config?.apiKeys?.googleMap;
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    if (!apiKey || text.trim().length < 3) {
      setAddressSuggestions([]);
      setFetchingSuggestions(false);
      return;
    }
    setFetchingSuggestions(true);
    const reqId = ++addressReqIdRef.current;
    addressDebounceRef.current = setTimeout(async () => {
      const suggestions = await fetchPlaceSuggestions(text, apiKey);
      // Drop if a newer keystroke superseded this request or we unmounted.
      if (!addressMountedRef.current || reqId !== addressReqIdRef.current) return;
      setAddressSuggestions(suggestions);
      setFetchingSuggestions(false);
    }, 400);
  };

  const handleSelectSuggestion = async (prediction: PlacePrediction) => {
    if (addressDebounceRef.current) clearTimeout(addressDebounceRef.current);
    addressReqIdRef.current++; // invalidate any in-flight suggestion fetch
    setAddressSuggestions([]);
    setFetchingSuggestions(false);
    setAddressQuery(prediction.description);
    const apiKey = config?.apiKeys?.googleMap;
    if (!apiKey) {
      setEditAddress(prediction.description);
      return;
    }
    const formatted = await fetchPlaceDetails(prediction.place_id, apiKey);
    if (!addressMountedRef.current) return;
    const finalAddress = formatted || prediction.description;
    setEditAddress(finalAddress);
    setAddressQuery(finalAddress);
  };

  const handleUseEnteredAddress = () => {
    const trimmed = addressQuery.trim();
    if (trimmed) {
      setEditAddress(trimmed);
      setAddressSuggestions([]);
    }
  };

  const handleChangeAddress = () => {
    setAddressQuery(editAddress);
    setEditAddress('');
    setAddressSuggestions([]);
  };

  const handleSaveProfile = async () => {
    if (!editBusName || !editEmail) {
      Alert.alert("Error", "Business Name and Email are required.");
      return;
    }
    if (!editAddress) {
      Alert.alert(
        "Confirm Your Address",
        addressQuery.trim()
          ? "Select a suggestion or tap “Confirm this address” to lock in your HQ address before saving."
          : "Please search for and confirm your HQ address.",
      );
      return;
    }

    // Verify the address with Google before saving (parity with onboarding). Skip
    // re-verification only when the address is unchanged AND we already have coords.
    const apiKey = config?.apiKeys?.googleMap;
    let coords: { lat: number; lng: number } | null = null;
    const addressUnchanged = editAddress.trim() === (profile?.address || '').trim();
    if (apiKey && !(addressUnchanged && profile?.lat != null && profile?.lng != null)) {
      setValidatingAddress(true);
      coords = await geocodeAddress(editAddress, apiKey);
      setValidatingAddress(false);
      if (!coords) {
        Alert.alert(
          'Address Not Found',
          "We couldn't verify that address. Please enter a full street address including city, state and zip.",
        );
        return;
      }
    }

    // Service-area zip is derived from the address (not the store identifier in the
    // doc key) — broadcast order matching keys off this field.
    const serviceZip = extractZipFromAddress(editAddress);
    if (!serviceZip) {
      Alert.alert('Address Zip Missing', "We couldn't read a 5-digit zip from your address. Please include the zip code.");
      return;
    }

    try {

      await db.collection('providers').doc(profile.id).update({
        businessName: editBusName,
        email: editEmail,
        address: editAddress,
        zipCode: serviceZip,
        ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
        businessHours: editHours,
        slotCapacity: parseInt(editSlotCapacity) || 5,
        turnaroundNormal: parseInt(editTurnaroundNormal, 10) || 0,
        turnaroundPriority: parseInt(editTurnaroundPriority, 10) || 0,
        chargesPriorityFee: editChargesPriorityFee,
        priorityPrice: editChargesPriorityFee ? (parseFloat(editPriorityPrice) || 0) : 0,
        chargesSalesTax: editChargesSalesTax,
        // Stored as a decimal (8.625% → 0.08625), same as onboarding.
        salesTaxRate: editChargesSalesTax ? (parseFloat(editSalesTaxRate) || 0) / 100 : 0,
        pickupEnabled: editPickupEnabled,
        onboarded: true // Mark as fully configured to receive broadcast orders
      });
      setIsEditing(false);
    } catch (error) {
      Alert.alert("Update Failed", "Could not sync business changes.");
    }
  };

  const handleSignOut = () => signOutClean();

  const handleDeleteAccount = async () => {
    try {
      await db.collection('archivedProviders').doc(profile.id).set({
        ...profile,
        archivedAt: new Date().toISOString()
      });
      await db.collection('providers').doc(profile.id).delete();
      await signOutClean();
    } catch (error) {
      console.warn('Provider archival/delete failed:', error);
      Alert.alert("Error", "Archival sequence failed.");
    }
  };

  const handleTogglePickup = async (val: boolean) => {
    if (!profile?.id) return;
    try {
      await db.collection('providers').doc(profile.id).update({ pickupEnabled: val });
    } catch {
      Alert.alert('Error', 'Could not update pickup status.');
    }
  };

  // Master availability switch. When off, this store stops receiving broadcast
  // requests and is hidden from customer search until turned back on.
  const handleToggleServices = async (val: boolean) => {
    if (!profile?.id) return;
    try {
      await db.collection('providers').doc(profile.id).update({ servicesActive: val });
    } catch {
      Alert.alert('Error', 'Could not update service availability.');
    }
  };

  // Mirror the sound preference into the active store's provider doc so the
  // backend can play the chosen sound on background/killed pushes (it can't read
  // on-device AsyncStorage). Best-effort: AsyncStorage stays the source of truth
  // for foreground playback. NOTE: applies to the active store only — a multi-store
  // provider's other stores fall back to the default sound until selected there.
  const persistProviderSoundPref = async (fields: Record<string, any>) => {
    try {
      const id = await getActiveProviderId();
      if (id) await db.collection('providers').doc(id).set(fields, { merge: true });
    } catch (e) {
      console.warn('Failed to sync sound preference to Firestore:', e);
    }
  };

  const handleToggleSound = async (val: boolean) => {
    setSoundEnabled(val);
    await ReactNativeAsyncStorage.setItem('@notification_sound_enabled', val ? 'true' : 'false');
    await persistProviderSoundPref({ notificationSoundEnabled: val });
  };

  const handleSelectSound = async (soundName: string) => {
    setSelectedSound(soundName);
    await ReactNativeAsyncStorage.setItem('@notification_sound_selection', soundName);
    setShowSoundPicker(false);
    await persistProviderSoundPref({ notificationSound: soundName });
  };

  const handlePreviewSound = async (soundName: string) => {
    setPreviewingSound(soundName);
    await previewSound(soundName);
    // Track the timer so an unmount before it fires can cancel it (see cleanup).
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => setPreviewingSound(null), 2500);
  };

  // Store switcher: every store this phone may operate — the ones it created AND
  // the ones it was invited to. Driven by membership (providers/{id}/members/
  // {phone}), not by "the store's phoneNumber field is mine", so a member sees the
  // stores they joined rather than only stores they own.
  const openStoreSwitcher = async () => {
    setShowStoreSwitcher(true);
    try {
      setOwnedStores(await listMyStores());
    } catch (e: any) {
      console.warn('Store list error:', e?.message);
    }
  };

  const handlePickStore = async (store: any) => {
    setShowStoreSwitcher(false);
    if (!store?.id || store.id === profile?.id) return;
    // The store's document id, verbatim — it is no longer recomputable from the
    // signed-in phone once stores can be shared.
    await switchStore(store.id);
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-white">
        <ActivityIndicator color={COLORS.brand.green} />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      {/* Provider Header */}
      <View className="bg-slate-900 px-4 pb-4 border-b-4 border-black shadow-sm flex-row justify-between items-end" style={{ paddingTop: top + 16 }}>
        <View className="flex-row items-center gap-3">
          {navigation.canGoBack() && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="p-2 bg-slate-800 rounded-xl border-2 border-black"
            >
              <ArrowLeft size={18} color="white" />
            </TouchableOpacity>
          )}
          <Text className="text-2xl font-black text-white uppercase tracking-tighter">HQ.<Text className="text-brand-green">Account</Text></Text>
        </View>
        {!isEditing && (
          <View className="flex-row items-center gap-2">
            <TouchableOpacity
              onPress={openStoreSwitcher}
              className="bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 flex-row items-center gap-2"
            >
              <Building size={12} color={COLORS.brand.green} />
              <Text className="text-brand-green font-black text-[10px] uppercase">Switch</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setIsEditing(true)}
              className="bg-slate-900 px-4 py-2 rounded-xl border border-slate-800 flex-row items-center gap-2"
            >
              <Edit2 size={12} color={COLORS.brand.green} />
              <Text className="text-brand-green font-black text-[10px] uppercase">Edit HQ</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <ScrollView className="flex-1 px-4 py-6" showsVerticalScrollIndicator={false}>
        {/* Business Tile */}
        <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist mb-6">
          <View className="flex-row items-center gap-4 mb-6">
            <View className="w-16 h-16 bg-brand-green rounded-2xl items-center justify-center border-2 border-black">
              <Building size={32} color="black" />
            </View>
            <View className="flex-1">
              <Text className="text-lg font-black text-white uppercase leading-tight">{profile?.businessName || 'Unnamed Business'}</Text>
              <Text className="text-[10px] font-mono text-slate-300 font-bold uppercase">{user?.phoneNumber} | {profile?.zipCode}</Text>
            </View>
          </View>

          <View className="space-y-4">
            <View className="flex-row items-center gap-3">
              <Mail size={16} color="#475569" />
              <Text className="text-xs font-bold text-slate-300">{profile?.email || '—'}</Text>
            </View>
            <View className="flex-row items-start gap-3">
              <MapPin size={16} color="#475569" className="mt-0.5" />
              <Text className="text-xs font-bold text-slate-300 flex-1 leading-relaxed">{profile?.address || '—'}</Text>
            </View>
          </View>
        </View>

        {/* Services & Pricing Tile */}
        <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist mb-4">
          <Text className="text-[10px] font-mono font-black text-slate-300 uppercase tracking-widest mb-4">Services & Pricing</Text>

          <Text className="text-[11px] font-bold text-slate-400 leading-relaxed mb-4">
            Bike models, rates and fees are set once for the whole platform in the Foodyzz
            admin hub (Settings → Bike Models &amp; Rates), so there is nothing to price here.
          </Text>

          {/* Services availability — master on/off. Off = no broadcasts / hidden from search. */}
          <View className="flex-row items-center justify-between pt-4 border-t border-slate-800 mt-4">
            <View className="flex-row items-center gap-3 flex-1">
              <Power size={16} color={(profile?.servicesActive ?? true) ? '#10b981' : '#475569'} />
              <View className="flex-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-xs font-black text-white uppercase">Services</Text>
                  {(profile?.servicesActive ?? true) ? (
                    <View className="bg-emerald-500/20 border border-emerald-500/40 rounded-lg px-2 py-0.5">
                      <Text className="text-emerald-400 text-[9px] font-black uppercase">Active</Text>
                    </View>
                  ) : (
                    <View className="bg-slate-700/40 border border-slate-600 rounded-lg px-2 py-0.5">
                      <Text className="text-slate-400 text-[9px] font-black uppercase">Off</Text>
                    </View>
                  )}
                </View>
                <Text className="text-[9px] text-slate-500 font-bold uppercase">Turn off to pause broadcast requests</Text>
              </View>
            </View>
            <Switch
              value={profile?.servicesActive ?? true}
              onValueChange={handleToggleServices}
              trackColor={{ false: '#1e293b', true: '#86B54F' }}
              thumbColor={(profile?.servicesActive ?? true) ? '#ffffff' : '#475569'}
            />
          </View>
        </View>

        {/* Operating Hours Overview */}
        <View className="bg-slate-950 border-2 border-slate-800 rounded-3xl p-5 mb-4">
          <Text className="text-[10px] font-mono font-black text-slate-300 uppercase tracking-widest mb-3">Weekly Operating Hours</Text>
          <View className="space-y-1.5">
            {Object.entries(profile?.businessHours || {}).map(([day, hours]) => (
              <View key={day} className="flex-row justify-between border-b border-slate-900 pb-1">
                <Text className="text-[10px] font-bold text-slate-300 uppercase">{day.slice(0, 3)}</Text>
                <Text className="text-[10px] font-mono font-bold text-white">{hours as string}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Notification Sound Node */}
        <View className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 mb-4 shadow-brutalist">
          <View className="flex-row items-center gap-2 mb-4">
            <Bell size={16} color="#86B54F" />
            <Text className="text-[10px] font-mono font-black text-slate-300 uppercase tracking-widest">Notification Sound</Text>
          </View>

          <View className="flex-row justify-between items-center mb-3 pb-3 border-b border-slate-800">
            <View className="flex-1 pr-4">
              <Text className="text-xs font-black text-white uppercase">Sound Alerts</Text>
              <Text className="text-[9px] text-slate-400 font-bold uppercase leading-tight mt-0.5">Play sound for incoming orders</Text>
            </View>
            <Switch
              value={soundEnabled}
              onValueChange={handleToggleSound}
              trackColor={{ false: '#1e293b', true: '#86B54F' }}
              thumbColor={soundEnabled ? '#ffffff' : '#475569'}
            />
          </View>

          {soundEnabled && (
            <TouchableOpacity
              onPress={() => setShowSoundPicker(true)}
              className="flex-row justify-between items-center"
            >
              <View className="flex-row items-center gap-2">
                <Volume2 size={14} color="#475569" />
                <Text className="text-xs font-bold text-slate-300 uppercase">
                  {SOUND_OPTIONS.find(s => s.key === selectedSound)?.label ?? 'Bell'}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="text-[9px] text-slate-500 font-bold uppercase">Change</Text>
                <ChevronRight size={14} color="#475569" />
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Support Chat */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Support')}
          className="bg-slate-900 border-2 border-slate-800 rounded-3xl p-5 mb-4 shadow-brutalist flex-row justify-between items-center"
        >
          <View className="flex-row items-center gap-3">
            <MessageSquare size={20} color={COLORS.brand.green} />
            <View>
              <Text className="text-xs font-black text-white uppercase">Partner Support Chat</Text>
              <Text className="text-[9px] text-slate-400 font-bold uppercase mt-0.5">Live Admin Desk</Text>
            </View>
          </View>
          <ChevronRight size={18} color="#475569" />
        </TouchableOpacity>

        {/* Sign Out */}
        <TouchableOpacity
          onPress={handleSignOut}
          className="bg-slate-950 border-2 border-slate-800 rounded-3xl p-5 mb-4 flex-row justify-between items-center"
        >
          <View className="flex-row items-center gap-3">
            <LogOut size={20} color="#94a3b8" />
            <Text className="text-xs font-black text-slate-300 uppercase">Exit Command Center</Text>
          </View>
          <ChevronRight size={18} color="#475569" />
        </TouchableOpacity>

        {/* Danger Zone */}
        <View className="bg-rose-950/20 border-2 border-rose-900/30 rounded-3xl p-5 mb-4">
          <View className="flex-row items-center gap-2 mb-2">
            <AlertTriangle size={16} color="#e11d48" />
            <Text className="text-xs font-black uppercase text-rose-500">De-register Partner Profile</Text>
          </View>
          <Text className="text-[9px] text-rose-500/70 font-bold uppercase leading-relaxed mb-4">
            Permanently purge business statistics, promo campaigns, and active routing handles.
          </Text>
          <TouchableOpacity
            onPress={() => setShowDeleteConfirm(true)}
            className="bg-rose-600 py-3 rounded-xl items-center border-2 border-black"
          >
            <Text className="text-white font-black text-[10px] uppercase">Purge HQ Record</Text>
          </TouchableOpacity>
        </View>

        {/* Legal / support links + app version */}
        <View className="items-center mb-12 mt-1">
          <View className="flex-row items-center justify-center flex-wrap gap-x-5 gap-y-2">
            {config?.legal?.privacy ? (
              <TouchableOpacity onPress={() => Linking.openURL(config.legal!.privacy!).catch(() => Alert.alert('Error', 'Could not open Privacy Policy.'))}>
                <Text className="text-[10px] font-black uppercase text-slate-500 underline tracking-widest">Privacy</Text>
              </TouchableOpacity>
            ) : null}
            {config?.hqfaq ? (
              <TouchableOpacity onPress={() => Linking.openURL(config.hqfaq).catch(() => Alert.alert('Error', 'Could not open FAQs.'))}>
                <Text className="text-[10px] font-black uppercase text-slate-500 underline tracking-widest">FAQs</Text>
              </TouchableOpacity>
            ) : null}
            {config?.contactus ? (
              <TouchableOpacity onPress={() => Linking.openURL(config.contactus).catch(() => Alert.alert('Error', 'Could not open Contact Us.'))}>
                <Text className="text-[10px] font-black uppercase text-slate-500 underline tracking-widest">Contact Us</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          {Constants.expoConfig?.version ? (
            <Text className="text-[9px] font-bold uppercase text-slate-600 tracking-widest mt-3">Version {Constants.expoConfig.version}</Text>
          ) : null}
        </View>
      </ScrollView>

      {/* Edit HQ Modal */}
      <Modal visible={isEditing} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/90 justify-end">
          <View className="bg-[#020617] rounded-t-[44px] border-t-4 border-slate-800 p-6 h-[90%]">
            <View className="flex-row justify-between items-center mb-6">
              <Text className="text-white text-xl font-black uppercase tracking-tighter">Edit HQ Details</Text>
              <View className="flex-row items-center gap-2">
                {/* Quick-save — same action as the Sync HQ Records button below. */}
                <TouchableOpacity
                  onPress={handleSaveProfile}
                  disabled={validatingAddress}
                  accessibilityLabel="Save HQ records"
                  className="p-2 bg-[#86B54F] border border-black rounded-full"
                  style={{ opacity: validatingAddress ? 0.6 : 1 }}
                >
                  {validatingAddress ? <ActivityIndicator size="small" color="white" /> : <Save size={20} color="white" />}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setIsEditing(false)} className="p-2 bg-slate-900 border border-slate-800 rounded-full">
                  <X size={20} color="white" />
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} className="space-y-6">
              {/* Section: Business Info */}
              <View className="space-y-4">
                <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-1">1. Business Identity</Text>
                <TextInput
                  value={editBusName} onChangeText={setEditBusName} placeholder="Business Name" placeholderTextColor="#94a3b8"
                  className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold text-white"
                />
                <TextInput
                  value={editEmail} onChangeText={setEditEmail} placeholder="Support Email" placeholderTextColor="#94a3b8"
                  className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold text-white font-mono"
                />
                {/* HQ Address — autocomplete (parity with onboarding) */}
                <View>
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center gap-2">
                      <MapPin size={14} color="#86B54F" />
                      <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">HQ Address</Text>
                    </View>
                    {fetchingSuggestions && <ActivityIndicator size="small" color="#86B54F" />}
                  </View>

                  <Text className="text-slate-500 text-[9px] font-mono uppercase mb-2">
                    Search & select your address — e.g. 217 Broadway, New York, NY 10007
                  </Text>

                  {/* Single always-visible input — border turns green when confirmed */}
                  <View className={`border-2 rounded-2xl overflow-hidden ${editAddress ? 'border-emerald-500' : 'border-slate-800'}`}>
                    <TextInput
                      value={editAddress || addressQuery}
                      onChangeText={editAddress ? undefined : handleAddressInputChange}
                      editable={!editAddress}
                      placeholder="e.g. 217 Broadway, New York, NY 10007"
                      placeholderTextColor="#475569"
                      className="bg-slate-950 p-4 font-bold text-white"
                      autoCorrect={false}
                    />
                    {editAddress ? (
                      <View className="bg-emerald-500/10 px-4 py-2 flex-row items-center gap-2 border-t border-emerald-500/30">
                        <CheckCircle size={12} color="#10b981" />
                        <Text className="text-emerald-400 text-[9px] font-black uppercase flex-1">Address confirmed</Text>
                        <TouchableOpacity onPress={handleChangeAddress} className="flex-row items-center gap-1">
                          <X size={11} color="#86B54F" />
                          <Text className="text-brand-green text-[9px] font-black uppercase">Change</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
                  </View>

                  {/* Suggestion dropdown */}
                  {!editAddress && addressSuggestions.length > 0 && (
                    <View className="bg-slate-950 border-2 border-slate-700 rounded-2xl mt-1 overflow-hidden">
                      {addressSuggestions.map((pred) => (
                        <TouchableOpacity
                          key={pred.place_id}
                          onPress={() => handleSelectSuggestion(pred)}
                          className="flex-row items-start gap-3 px-4 py-3 border-b border-slate-800"
                        >
                          <MapPin size={12} color="#86B54F" style={{ marginTop: 2 }} />
                          <Text className="text-xs text-slate-200 font-bold flex-1 leading-relaxed">{pred.description}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {/* Confirm button — only once the typed address looks complete */}
                  {!editAddress && !fetchingSuggestions && addressSuggestions.length === 0 && addressQuery.includes(',') && addressQuery.trim().length >= 15 && (
                    <TouchableOpacity
                      onPress={handleUseEnteredAddress}
                      className="mt-2 flex-row items-center gap-2 p-4 bg-[#86B54F]/10 border-2 border-[#86B54F]/50 rounded-xl"
                    >
                      <Check size={16} color="#86B54F" />
                      <View className="flex-1">
                        <Text className="text-brand-green text-xs font-black uppercase">Confirm this address</Text>
                        <Text className="text-brand-green/60 text-[9px] font-mono uppercase mt-0.5">{addressQuery.trim()}</Text>
                      </View>
                      <ArrowRight size={16} color="#86B54F" />
                    </TouchableOpacity>
                  )}

                  {/* Guide shown when typing but no comma yet */}
                  {!editAddress && !fetchingSuggestions && addressSuggestions.length === 0 && addressQuery.trim().length >= 5 && !addressQuery.includes(',') && (
                    <View className="mt-2 p-3 bg-slate-800/60 border border-slate-700 rounded-xl">
                      <Text className="text-slate-400 text-[9px] font-mono uppercase leading-relaxed">
                        Include city, state & zip — e.g. "217 Broadway, New York, NY 10007"
                      </Text>
                    </View>
                  )}
                </View>
              </View>

              {/* Section: Services & Pricing */}
              <View className="space-y-4">
                <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-1">2. Services & Pricing</Text>

                <Text className="text-[11px] font-bold text-slate-400 leading-relaxed">
                  Bike models, rates and fees are configured platform-wide in the admin hub.
                </Text>
              </View>

              {/* Section: Business Hours Editor */}
              <View className="space-y-4">
                <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-1">3. Operating Hours</Text>
                <View className="grid grid-cols-2 gap-2 flex-row flex-wrap">
                  {Object.keys(editHours).map((day) => (
                    <View key={day} className="w-[48%] mb-2">
                      <Text className="text-[8px] font-black text-slate-200 uppercase mb-1 ml-1">{day}</Text>
                      <TextInput
                        value={(editHours as any)[day]}
                        onChangeText={(text) => setEditOperatingHours(prev => ({ ...prev, [day]: text }))}
                        className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[10px] text-white font-mono font-bold text-center"
                      />
                    </View>
                  ))}
                </View>
              </View>

              {/* Section: Logistics Capacity */}
              <View className="space-y-4">
                <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-1">4. Logistics Capacity</Text>
                <View>
                  <Text className="text-[8px] font-black text-slate-200 uppercase mb-1 ml-1">Concurrent Order Slots</Text>
                  <TextInput
                    value={editSlotCapacity} onChangeText={setEditSlotCapacity} placeholder="e.g. 5" placeholderTextColor="#94a3b8"
                    keyboardType="numeric"
                    className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold text-white font-mono"
                  />
                </View>
              </View>

              <TouchableOpacity
                onPress={handleSaveProfile}
                disabled={validatingAddress}
                className="bg-[#86B54F] py-5 rounded-3xl items-center shadow-brutalist border-2 border-black mt-4"
                style={{ opacity: validatingAddress ? 0.6 : 1 }}
              >
                {validatingAddress ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text className="text-white font-black uppercase text-base tracking-tighter">Sync HQ Records</Text>
                )}
              </TouchableOpacity>
              <View className="h-12" />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Sound Picker Modal */}
      <Modal visible={showSoundPicker} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/90 justify-end">
          <View className="bg-[#020617] rounded-t-[44px] border-t-4 border-slate-800 p-6" style={{ maxHeight: '72%' }}>
            <View className="flex-row justify-between items-center mb-6">
              <View>
                <Text className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Notification Node</Text>
                <Text className="text-white text-xl font-black uppercase tracking-tighter">Choose Sound</Text>
              </View>
              <TouchableOpacity
                onPress={() => { stopCurrentSound(); setShowSoundPicker(false); }}
                className="p-2 bg-slate-900 border border-slate-800 rounded-full"
              >
                <X size={20} color="white" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {SOUND_OPTIONS.map((option) => {
                const isSelected = selectedSound === option.key;
                const isPreviewing = previewingSound === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => handleSelectSound(option.key)}
                    className={`flex-row justify-between items-center p-4 mb-2 rounded-2xl border-2 ${
                      isSelected ? 'bg-slate-800 border-brand-green' : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <View className={`w-4 h-4 rounded-full border-2 items-center justify-center ${
                        isSelected ? 'border-brand-green bg-brand-green' : 'border-slate-600'
                      }`}>
                        {isSelected && <View className="w-2 h-2 rounded-full bg-white" />}
                      </View>
                      <Text className={`text-xs font-black uppercase ${isSelected ? 'text-black' : 'text-slate-300'}`}>
                        {option.label}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); handlePreviewSound(option.key); }}
                      className={`px-3 py-1.5 rounded-xl border ${
                        isPreviewing ? 'bg-brand-green/20 border-brand-green' : 'bg-slate-900 border-slate-700'
                      }`}
                    >
                      <Text className={`text-[9px] font-black uppercase ${isPreviewing ? 'text-brand-green' : 'text-slate-400'}`}>
                        {isPreviewing ? 'Playing...' : 'Preview'}
                      </Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Store Switcher Modal */}
      <Modal visible={showStoreSwitcher} animationType="slide" transparent={true}>
        <View className="flex-1 bg-black/90 justify-end">
          <View className="bg-[#020617] rounded-t-[44px] border-t-4 border-slate-800 p-6" style={{ maxHeight: '72%' }}>
            <View className="flex-row justify-between items-center mb-6">
              <View>
                <Text className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">Active Store Node</Text>
                <Text className="text-white text-xl font-black uppercase tracking-tighter">Switch Store</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowStoreSwitcher(false)}
                className="p-2 bg-slate-900 border border-slate-800 rounded-full"
              >
                <X size={20} color="white" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {ownedStores.length === 0 ? (
                <Text className="text-slate-500 font-bold text-xs uppercase text-center py-8">No other stores for this number.</Text>
              ) : ownedStores.map((store) => {
                const isActive = store.id === profile?.id;
                return (
                  <TouchableOpacity
                    key={store.id}
                    onPress={() => handlePickStore(store)}
                    className={`flex-row justify-between items-center p-4 mb-2 rounded-2xl border-2 ${
                      isActive ? 'bg-slate-800 border-brand-green' : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <View className="flex-row items-center gap-3 flex-1">
                      <Building size={16} color={isActive ? COLORS.brand.green : '#475569'} />
                      <View className="flex-1">
                        <Text className={`text-xs font-black uppercase ${isActive ? 'text-white' : 'text-slate-300'}`}>
                          {store.businessName || 'Unnamed Store'}
                        </Text>
                        <Text className="text-[10px] font-mono text-slate-500 font-bold uppercase">
                          Zip {store.zipCode}{store.role === 'staff' ? ' · Member' : ''}
                        </Text>
                      </View>
                    </View>
                    {isActive && <CheckCircle size={18} color={COLORS.brand.green} />}
                  </TouchableOpacity>
                );
              })}
              <View style={{ height: 24 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal visible={showDeleteConfirm} transparent={true} animationType="fade">
        <View className="flex-1 bg-black/90 justify-center items-center p-6">
          <View className="bg-slate-900 rounded-[40px] p-8 w-full border-4 border-slate-800 shadow-brutalist">
            <View className="w-16 h-16 bg-rose-500/10 rounded-full items-center justify-center mx-auto mb-4 border-2 border-rose-500/20">
              <AlertTriangle size={32} color="#e11d48" />
            </View>
            <Text className="text-center font-black text-xl text-white uppercase mb-2">Delete HQ Profile?</Text>
            <Text className="text-center text-slate-500 font-bold text-xs leading-relaxed mb-8">
              Are you absolutely sure? This will wipe your active routing handles, promotions, and logs permanently.
            </Text>
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => setShowDeleteConfirm(false)}
                className="flex-1 py-4 bg-slate-800 rounded-2xl border-2 border-slate-700 items-center"
              >
                <Text className="text-slate-300 font-black uppercase text-xs">Abort</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleDeleteAccount}
                className="flex-1 py-4 bg-rose-600 rounded-2xl border-2 border-black shadow-sm items-center"
              >
                <Text className="text-white font-black uppercase text-xs">Purge</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
