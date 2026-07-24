import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, KeyboardAvoidingView, Platform, Vibration,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Building, MapPin, Mail, DollarSign, Truck, CheckCircle, X,
  ArrowRight, ArrowLeft, Check, CreditCard, Bell, Tags, Zap, Clock, Percent, ShieldCheck,
} from 'lucide-react-native';
import { db, signOutClean } from '../services/firebase';
import { extractZipFromAddress } from '../utils/address';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseAuthTypes } from '@react-native-firebase/auth';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PlacePrediction {
  description: string;
  place_id: string;
}

interface BusinessHours {
  monday: string;
  tuesday: string;
  wednesday: string;
  thursday: string;
  friday: string;
  saturday: string;
  sunday: string;
}


// ─── Constants ────────────────────────────────────────────────────────────────

// Case numbers of the steps that survive the bike rewire, in order. Driving
// navigation off this (rather than step+1) means the remaining `case` bodies keep
// their original numbers.
const STEP_SEQUENCE = [1, 2, 4, 7, 9];
const TOTAL_STEPS = STEP_SEQUENCE.length;

const DEFAULT_HOURS: BusinessHours = {
  monday: '08:00 - 22:00',
  tuesday: '08:00 - 22:00',
  wednesday: '08:00 - 22:00',
  thursday: '08:00 - 22:00',
  friday: '08:00 - 23:00',
  saturday: '07:00 - 23:00',
  sunday: '08:00 - 21:00',
};

const DAYS_ORDER: (keyof BusinessHours)[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const DAY_MAP: Record<number, keyof BusinessHours> = {
  0: 'sunday', 1: 'monday', 2: 'tuesday', 3: 'wednesday',
  4: 'thursday', 5: 'friday', 6: 'saturday',
};


const STEP_TITLES = [
  'Business Identity',
  'Operating Hours',
  '',   // (removed) per-unit pricing step
  'Pickup & Dropoff',
  '',   // (removed) dry cleaning
  '',   // (removed) provider payout cadence
  'Sales Tax',
  '',   // (removed) Stripe Connect bank setup
  "You're Live!",
];

// ─── Google Places helpers (module-level) ─────────────────────────────────────

async function fetchPlaceSuggestions(input: string, apiKey: string): Promise<PlacePrediction[]> {
  if (!input.trim() || input.trim().length < 3) return [];
  try {
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`
      + `?input=${encodeURIComponent(input.trim())}`
      + `&types=address`
      + `&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
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

async function fetchPlaceDetails(
  placeId: string,
  apiKey: string,
): Promise<{ formattedAddress: string; hours: BusinessHours | null; coords: { lat: number; lng: number } | null }> {
  try {
    // geometry/location is REQUIRED: the provider's lat/lng drives broadcast
    // targeting (onOrderCreatedNotify + DispatchScreen.withinBroadcastRadius).
    // A provider doc with no numeric lat/lng receives NO broadcasts.
    const url = `https://maps.googleapis.com/maps/api/place/details/json`
      + `?place_id=${encodeURIComponent(placeId)}`
      + `&fields=formatted_address,opening_hours,geometry/location`
      + `&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const result = data?.result;
    const formattedAddress: string = result?.formatted_address || '';
    const periods = result?.opening_hours?.periods;
    const hours = periods ? convertGooglePeriods(periods) : null;
    const loc = result?.geometry?.location;
    const coords = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
      ? { lat: loc.lat, lng: loc.lng } : null;
    return { formattedAddress, hours, coords };
  } catch (e) {
    console.warn('fetchPlaceDetails error:', e);
    return { formattedAddress: '', hours: null, coords: null };
  }
}

// Fallback geocode for a manually-typed address (no place_id). Mirrors
// AccountScreen.geocodeAddress so onboarding always persists provider lat/lng.
async function geocodeAddress(address: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address.trim())}&key=${apiKey}`;
    const res = await fetch(url);
    const data: any = await res.json();
    const loc = data?.results?.[0]?.geometry?.location;
    if (data?.status === 'OK' && loc && typeof loc.lat === 'number') return { lat: loc.lat, lng: loc.lng };
    return null;
  } catch {
    return null;
  }
}

function convertGooglePeriods(periods: any[]): BusinessHours {
  const hours: BusinessHours = { ...DEFAULT_HOURS };
  for (const period of periods) {
    const dayKey = DAY_MAP[period.open?.day];
    if (!dayKey) continue;
    const openRaw: string = period.open?.time || '0000';
    const closeRaw: string = period.close?.time || '0000';
    hours[dayKey] = `${openRaw.slice(0, 2)}:${openRaw.slice(2)} - ${closeRaw.slice(0, 2)}:${closeRaw.slice(2)}`;
  }
  return hours;
}

// ─── Currency input row ───────────────────────────────────────────────────────

function CurrencyInput({
  label,
  value,
  onChange,
  placeholder = '0.00',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <View className="mb-4">
      <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">{label}</Text>
      <View className="flex-row items-center border-2 border-slate-800 rounded-2xl overflow-hidden">
        <View className="bg-slate-800 px-4 py-4 border-r border-slate-700">
          <Text className="text-white font-black text-sm">$</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor="#475569"
          className="flex-1 bg-slate-950 p-4 font-mono text-white text-sm font-bold"
        />
      </View>
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ProviderOnboardingWizard({
  user,
  onComplete,
}: {
  user: FirebaseAuthTypes.User;
  onComplete?: () => void;
}) {
  const { top, bottom } = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);

  // ── Navigation ──
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // ── Google API key ──
  const [googleApiKey, setGoogleApiKey] = useState<string | null>(null);
  const [deliveryFee, setDeliveryFee] = useState<number>(9.99);

  // ── Step 1: Business Identity ──
  const [businessName, setBusinessName] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [addressQuery, setAddressQuery] = useState('');
  const [addressSuggestions, setAddressSuggestions] = useState<PlacePrediction[]>([]);
  const [selectedAddress, setSelectedAddress] = useState('');
  // Provider coordinates resolved from the chosen place (or geocoded at save).
  // Persisted as lat/lng so the store is reachable by broadcast targeting.
  const [selectedCoords, setSelectedCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [fetchingSuggestions, setFetchingSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Production-safety for the Places-backed field: cancel the debounce on unmount
  // and discard stale/out-of-order fetch responses so we never setState on an
  // unmounted component.
  const addressMountedRef = useRef(true);
  const addressReqIdRef = useRef(0);

  // ── Step 2: Operating Hours ──
  const [businessHours, setBusinessHours] = useState<BusinessHours>({ ...DEFAULT_HOURS });
  const [hoursSyncedFromGoogle, setHoursSyncedFromGoogle] = useState(false);

  // ── Step 3: Pricing + Turnaround ──
  const [turnaroundNormal, setTurnaroundNormal] = useState('');   // whole days, e.g. "3"
  const [turnaroundPriority, setTurnaroundPriority] = useState(''); // whole days, e.g. "1"
  const [chargesPriorityFee, setChargesPriorityFee] = useState<boolean | null>(null);
  const [priorityPrice, setPriorityPrice] = useState(''); // flat $ surcharge, e.g. "8"

  // ── Step 4: Pickup ──
  const [pickupAnswer, setPickupAnswer] = useState<boolean | null>(null);
  const [pickupEnabled, setPickupEnabled] = useState(false);

  // ── Step 5: Dry Cleaning ──

  // ── Step 6: Terms ──
  const [termsAccepted, setTermsAccepted] = useState(false);

  // ── Step 7: Sales Tax ──
  const [chargesSalesTax, setChargesSalesTax] = useState<boolean | null>(null);
  const [salesTaxRate, setSalesTaxRate] = useState(''); // percent, e.g. "8.625"
  const [taxResponsibilityAccepted, setTaxResponsibilityAccepted] = useState(false);

  // ── Step 8: Payouts ──
  const [dailyPayoutFee, setDailyPayoutFee] = useState(0.99);
  // Platform's reference "1 load" weight, so providers price a load against the same
  // basis customers see when estimating loads in the request flow (apiConfig/global.avgLoadlbs).
  const [avgLoadLbs, setAvgLoadLbs] = useState<number>(15);
  // The provider doc is created (onboarded:false) when the user leaves the tax step,
  // so Stripe Connect has a real providerId to attach the payout account to. It flips
  // to onboarded:true at go-live. Until the doc exists, PayoutSetup stays disabled.
  const [providerId, setProviderId] = useState<string | null>(null);
  // Whether Stripe reports the bank/payout account is fully enabled. Connecting a
  // payout account is REQUIRED before going live, so this gates the payout step.
  // Memoized so PayoutSetup's internal refresh effect doesn't re-fire on every render.

  // ─── Scroll to top on step change ────────────────────────────────────────

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  // ─── Haptic on "You're Live!" screen ─────────────────────────────────────

  useEffect(() => {
    if (step === STEP_SEQUENCE[STEP_SEQUENCE.length - 1]) {
      // Burst pattern: 3 quick pulses over ~1 second
      Vibration.vibrate([0, 200, 100, 200, 100, 300]);
    }
  }, [step]);

  // ─── Tear down the address autocomplete's timer on unmount ────────────────

  useEffect(() => {
    return () => {
      addressMountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ─── On mount: fetch Google Maps API key ─────────────────────────────────

  useEffect(() => {
    db.collection('apiConfig').doc('global').get()
      .then(snap => {
        const k = snap.data()?.apiKeys?.googleMap;
        if (k) setGoogleApiKey(k);
        const df = snap.data()?.deliveryFee?.pickupDelivery;
        if (typeof df === 'number') setDeliveryFee(df);
        const dpf = snap.data()?.stripe?.dailyPayoutFee;
        if (typeof dpf === 'number') setDailyPayoutFee(dpf);
        const all = snap.data()?.avgLoadlbs;
        if (typeof all === 'number') setAvgLoadLbs(all);
      })
      .catch(e => console.warn('Failed to fetch global config:', e));
  }, []);

  // ─── Address autocomplete ─────────────────────────────────────────────────

  const handleAddressInputChange = (text: string) => {
    setAddressQuery(text);
    setSelectedAddress('');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!googleApiKey || text.trim().length < 3) {
      setAddressSuggestions([]);
      setFetchingSuggestions(false);
      return;
    }
    setFetchingSuggestions(true);
    const reqId = ++addressReqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      const suggestions = await fetchPlaceSuggestions(text, googleApiKey);
      // Drop if a newer keystroke superseded this request or we unmounted.
      if (!addressMountedRef.current || reqId !== addressReqIdRef.current) return;
      setAddressSuggestions(suggestions);
      setFetchingSuggestions(false);
    }, 400);
  };

  const handleSelectSuggestion = async (prediction: PlacePrediction) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    addressReqIdRef.current++; // invalidate any in-flight suggestion fetch
    setAddressSuggestions([]);
    setFetchingSuggestions(false);
    setAddressQuery(prediction.description);
    if (!googleApiKey) {
      setSelectedAddress(prediction.description);
      return;
    }
    const { formattedAddress, hours, coords } = await fetchPlaceDetails(prediction.place_id, googleApiKey);
    if (!addressMountedRef.current) return;
    const finalAddress = formattedAddress || prediction.description;
    setSelectedAddress(finalAddress);
    setAddressQuery(finalAddress);
    setSelectedCoords(coords);
    if (hours) {
      setBusinessHours(hours);
      setHoursSyncedFromGoogle(true);
    }
  };

  const handleUseEnteredAddress = () => {
    const trimmed = addressQuery.trim();
    if (trimmed) {
      setSelectedAddress(trimmed);
      setSelectedCoords(null); // manually typed → geocode at save time
      setAddressSuggestions([]);
    }
  };

  // ─── Validation ───────────────────────────────────────────────────────────

  const validateCurrentStep = (): string | null => {
    switch (step) {
      case 1: {
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!businessName.trim()) return 'Business name is required.';
        if (!EMAIL_RE.test(businessEmail.trim())) return 'Please enter a valid support email address.';
        if (!selectedAddress.trim()) return 'Please enter and confirm your full business address (street, city, state, zip).';
        return null;
      }
      case 2: {
        const fmt = /^\d{2}:\d{2} - \d{2}:\d{2}$/;
        for (const day of DAYS_ORDER) {
          if (!fmt.test(businessHours[day])) {
            return `Invalid format for ${day}. Use HH:MM - HH:MM (e.g. 09:00 - 21:00).`;
          }
        }
        return null;
      }
      case 4:
        if (pickupAnswer === null) return 'Please select Yes or No for pickup & dropoff.';
        return null;
      case 7:
        if (chargesSalesTax === null) return 'Please select whether you charge sales tax.';
        if (chargesSalesTax) {
          const rate = parseFloat(salesTaxRate);
          if (!salesTaxRate.trim() || isNaN(rate) || rate <= 0 || rate > 100)
            return 'Please enter a valid sales tax rate (e.g. 8.625).';
        }
        if (!taxResponsibilityAccepted) return 'You must acknowledge your sales tax responsibility to continue.';
        return null;
      default:
        return null;
    }
  };

  const handleNext = async () => {
    const error = validateCurrentStep();
    if (error) { Alert.alert('Required', error); return; }
    // Leaving the tax step, create the provider doc (onboarded:false) so the payout
    // step can attach a Stripe Connect account to a real providerId. Block advancing
    // if the doc can't be written (e.g. address can't be geocoded) — the same gate
    // that used to live only in the final save now happens here, earlier.
    if (step === 7) {
      setSaving(true);
      const ok = await persistProvider(false);
      setSaving(false);
      if (!ok) return;
    }
    const idx = STEP_SEQUENCE.indexOf(step);
    if (idx >= 0 && idx < STEP_SEQUENCE.length - 1) setStep(STEP_SEQUENCE[idx + 1]);
  };

  const handleBack = () => {
    const idx = STEP_SEQUENCE.indexOf(step);
    if (idx > 0) setStep(STEP_SEQUENCE[idx - 1]);
  };

  // ─── Provider doc save ──────────────────────────────────────────────────────

  // Write the provider doc from current form state. Shared by the pre-payout save
  // (onboarded:false — so Stripe Connect can attach to a real providerId) and the
  // final go-live save (onboarded:true). Returns true on success; surfaces any
  // validation/network failure via Alert and returns false. Callers own `saving`.
  const persistProvider = async (onboarded: boolean): Promise<boolean> => {
    try {
      const cleanPhone = user.phoneNumber?.replace(/\D/g, '') || user.email?.split('@')[0] || '';
      const zip = await ReactNativeAsyncStorage.getItem('active_provider_zip');
      if (!cleanPhone || !zip) throw new Error('Session missing phone or zip. Please sign in again.');

      // Service-area zip is derived from the confirmed address (NOT the store
      // identifier in the doc key) — this is what broadcast order matching uses.
      const serviceZip = extractZipFromAddress(selectedAddress);
      if (!serviceZip) {
        Alert.alert('Address Zip Missing', 'We could not read a 5-digit zip from your business address. Please re-enter your full address including the zip code.');
        return false;
      }

      // Resolve provider coordinates — REQUIRED for broadcast targeting. Prefer the
      // coords captured when a Places suggestion was chosen; otherwise geocode the
      // confirmed address now. Block the save if neither yields coordinates, since a
      // provider with no lat/lng would silently receive zero broadcasts.
      let coords = selectedCoords;
      if (!coords && googleApiKey) coords = await geocodeAddress(selectedAddress, googleApiKey);
      if (!coords) {
        Alert.alert(
          'Could Not Locate Address',
          'We could not pinpoint your business address on the map. Broadcasts are matched by distance, so a precise address is required. Please re-select your address from the suggestions.',
        );
        return false;
      }


      const docId = `${cleanPhone}_${zip}`;
      const writePromise = db.collection('providers').doc(docId).set({
        // Owner phone (digits-only). REQUIRED on every write: the Firestore rule
        // authorizes provider writes via ownsPhoneField(request.resource.data.phoneNumber).
        // On a merge that lands as a CREATE (doc not yet synced — common on the first
        // flaky sign-in), the rule has no existing phoneNumber to read, so omitting it
        // here makes the rule error → firestore/permission-denied. Always send it.
        phoneNumber: cleanPhone,
        businessName: businessName.trim(),
        email: businessEmail.trim(),
        address: selectedAddress,
        // lat/lng power broadcast distance matching — never omit.
        lat: coords.lat,
        lng: coords.lng,
        zipCode: serviceZip,
        turnaroundNormal: parseInt(turnaroundNormal, 10),
        turnaroundPriority: parseInt(turnaroundPriority, 10),
        chargesPriorityFee: chargesPriorityFee === true,
        priorityPrice: chargesPriorityFee === true ? parseFloat(priorityPrice) : 0,
        pickupEnabled,
        businessHours,
        // Sales tax the provider collects & remits; stored as a decimal rate.
        chargesSalesTax: chargesSalesTax === true,
        salesTaxRate: chargesSalesTax === true ? parseFloat(salesTaxRate) / 100 : 0,
        // Bank is connected directly to Stripe (PayoutSetup → Connect); we only persist
        // the payout cadence preference here (no bank/routing numbers stored). The
        // merge write never touches stripeAccountId, so it survives re-saves.
        slotCapacity: 5,
        // onboarded gates ALL order distribution + customer discovery, so the doc is
        // invisible to customers until go-live even though it exists for Stripe.
        onboarded,
        ...(onboarded ? { onboardedAt: new Date().toISOString() } : {}),
      }, { merge: true });

      // Surface a hanging Firestore write instead of spinning forever.
      const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('WRITE_TIMEOUT')), 12000)
      );
      await Promise.race([writePromise, timeout]);
      setProviderId(docId);
      return true;
    } catch (e: any) {
      if (e?.message === 'WRITE_TIMEOUT') {
        Alert.alert(
          'Write did not complete',
          'The Firestore write to providers/ did not get acknowledged within 12s. This is a network/Firestore connectivity issue. If the device later reconnects, please try again.'
        );
      } else if (e?.message?.startsWith('Session missing')) {
        // Orphaned auth session (valid Firebase Auth but no usable phone/zip) — the
        // user can't escape this on their own, so sign them out and route back to
        // the auth screen. onAuthStateChanged in App handles the redirect.
        Alert.alert('Session Expired', 'Please sign in again to continue.', [
          { text: 'OK', onPress: () => signOutClean().catch(() => {}) },
        ]);
      } else {
        Alert.alert('Save Failed', e.message || 'Could not complete onboarding. Please try again.');
      }
      return false;
    }
  };

  // ─── Final save ───────────────────────────────────────────────────────────

  const handleFinish = async () => {
    setSaving(true);
    const ok = await persistProvider(true);
    if (ok) {
      // Re-subscribe App's onboarded listener to the just-saved provider doc. The
      // initial listener may have run before active_provider_zip was readable (and
      // thus never subscribed), so it would otherwise miss this onboarded:true write.
      onComplete?.();
    } else {
      setSaving(false);
    }
  };

  // ─── Step content ─────────────────────────────────────────────────────────

  const renderStep = () => {
    switch (step) {

      // ── Step 1: Business Identity ────────────────────────────────────────
      case 1:
        return (
          <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist">
            <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-2 mb-5">
              Business Identity
            </Text>

            {/* Business Name */}
            <View className="mb-5">
              <View className="flex-row items-center gap-2 mb-2">
                <Building size={14} color="#86B54F" />
                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">Business Name</Text>
              </View>
              <TextInput
                value={businessName}
                onChangeText={setBusinessName}
                placeholder="e.g. Clean & Fresh Laundromat"
                placeholderTextColor="#475569"
                className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold text-white"
              />
            </View>

            {/* Support Email */}
            <View className="mb-5">
              <View className="flex-row items-center gap-2 mb-2">
                <Mail size={14} color="#86B54F" />
                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">Support Email</Text>
              </View>
              <TextInput
                value={businessEmail}
                onChangeText={setBusinessEmail}
                placeholder="contact@yourbusiness.com"
                placeholderTextColor="#475569"
                keyboardType="email-address"
                autoCapitalize="none"
                className="bg-slate-950 border-2 border-slate-800 rounded-2xl p-4 font-bold text-white"
              />
            </View>

            {/* Address */}
            <View>
              <View className="flex-row items-center justify-between mb-1">
                <View className="flex-row items-center gap-2">
                  <MapPin size={14} color="#86B54F" />
                  <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider">Business Address</Text>
                </View>
                {fetchingSuggestions && <ActivityIndicator size="small" color="#86B54F" />}
              </View>

              {/* Hint */}
              <Text className="text-slate-500 text-[9px] font-mono uppercase mb-2">
                e.g. 217 Broadway, New York, NY 10007 — then tap Confirm
              </Text>

              {/* Single always-visible input — border turns green when confirmed */}
              <View className={`border-2 rounded-2xl overflow-hidden ${selectedAddress ? 'border-emerald-500' : 'border-slate-800'}`}>
                <TextInput
                  value={selectedAddress || addressQuery}
                  onChangeText={selectedAddress ? undefined : handleAddressInputChange}
                  editable={!selectedAddress}
                  placeholder="e.g. 217 Broadway, New York, NY 10007"
                  placeholderTextColor="#475569"
                  className="bg-slate-950 p-4 font-bold text-white"
                  autoCorrect={false}
                />
                {selectedAddress ? (
                  /* Confirmed state: inline "Change" button inside input row */
                  <View className="bg-emerald-500/10 px-4 py-2 flex-row items-center gap-2 border-t border-emerald-500/30">
                    <CheckCircle size={12} color="#10b981" />
                    <Text className="text-emerald-400 text-[9px] font-black uppercase flex-1">Address confirmed</Text>
                    <TouchableOpacity
                      onPress={() => { setSelectedAddress(''); setSelectedCoords(null); setAddressQuery(''); setAddressSuggestions([]); }}
                      className="flex-row items-center gap-1"
                    >
                      <X size={11} color="#86B54F" />
                      <Text className="text-brand-green text-[9px] font-black uppercase">Change</Text>
                    </TouchableOpacity>
                  </View>
                ) : null}
              </View>

              {/* Suggestion dropdown */}
              {!selectedAddress && addressSuggestions.length > 0 && (
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

              {/* Confirm button — only shows once address looks complete (has a comma = city separator) */}
              {!selectedAddress && !fetchingSuggestions && addressSuggestions.length === 0 && addressQuery.includes(',') && addressQuery.trim().length >= 15 && (
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
              {!selectedAddress && !fetchingSuggestions && addressSuggestions.length === 0 && addressQuery.trim().length >= 5 && !addressQuery.includes(',') && (
                <View className="mt-2 p-3 bg-slate-800/60 border border-slate-700 rounded-xl">
                  <Text className="text-slate-400 text-[9px] font-mono uppercase leading-relaxed">
                    Include city, state & zip — e.g. "217 Broadway, New York, NY 10007"
                  </Text>
                </View>
              )}
            </View>
          </View>
        );

      // ── Step 2: Operating Hours ──────────────────────────────────────────
      case 2:
        return (
          <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist">
            <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-2 mb-4">
              Operating Hours
            </Text>

            {hoursSyncedFromGoogle && (
              <View className="flex-row items-center gap-2 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-3 mb-4">
                <CheckCircle size={14} color="#10b981" />
                <Text className="text-emerald-400 text-xs font-bold flex-1">Hours synced from Google Maps — edit if needed</Text>
              </View>
            )}

            <View className="flex-row items-center gap-2 mb-4">
              <Clock size={14} color="#475569" />
              <Text className="text-slate-500 text-[9px] font-mono uppercase">Format: HH:MM - HH:MM</Text>
            </View>

            <View className="flex-row flex-wrap gap-x-2">
              {DAYS_ORDER.map((day) => (
                <View key={day} style={{ width: '48%' }} className="mb-3">
                  <Text className="text-[8px] font-black text-slate-400 uppercase mb-1 ml-1">
                    {day.slice(0, 3).toUpperCase()}
                  </Text>
                  <TextInput
                    value={businessHours[day]}
                    onChangeText={(text) => setBusinessHours(prev => ({ ...prev, [day]: text }))}
                    placeholder="09:00 - 21:00"
                    placeholderTextColor="#475569"
                    className="bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-[10px] text-white font-mono font-bold text-center"
                    autoCorrect={false}
                  />
                </View>
              ))}
            </View>
          </View>
        );

      // ── Step 3: Rental Pricing + Turnaround ────────────────────────────
      case 4:
        return (
          <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist">
            <Text className="text-white text-[10px] font-black uppercase tracking-widest border-b border-slate-800 pb-2 mb-5">
              Pickup & Dropoff
            </Text>

            <View className="flex-row items-center gap-3 mb-5">
              <Truck size={20} color="#86B54F" />
              <Text className="text-white font-black text-base uppercase tracking-tight flex-1">
                Do you offer pickup & dropoff?
              </Text>
            </View>

            <View className="flex-row gap-3 mb-5">
              {([true, false] as const).map((val) => (
                <TouchableOpacity
                  key={String(val)}
                  onPress={() => {
                    setPickupAnswer(val);
                    if (!val) setPickupEnabled(false);
                  }}
                  className={`flex-1 py-4 rounded-2xl border-2 items-center ${
                    pickupAnswer === val
                      ? 'bg-[#86B54F] border-black'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <Text className={`text-sm font-black uppercase ${pickupAnswer === val ? 'text-black' : 'text-slate-300'}`}>
                    {val ? 'Yes' : 'No'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {pickupAnswer === true && (
              <>
                <View className="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-4 mb-4">
                  <Text className="text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2">
                    Flat Fee Notice
                  </Text>
                  <Text className="text-slate-300 text-xs font-bold leading-relaxed mb-3">
                    A <Text className="text-white font-black">${deliveryFee.toFixed(2)} flat fee</Text> is charged to the customer for each pickup & dropoff service. Are you comfortable with this? The <Text className="text-white font-black">${deliveryFee.toFixed(2)} goes to the driver</Text>. This will be deposited to your account with the order, and it is your responsibility to make the payment. Foodyzz does not take any portion or commission on delivery charges.
                  </Text>
                  <View className="border-t border-amber-500/20 pt-3">
                    <Text className="text-amber-300/80 text-[10px] font-bold leading-relaxed">
                      You are responsible for arranging pickup and dropoff times with the client. When requesting service, the client will provide a preferred time window.
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-3">
                  <TouchableOpacity
                    onPress={() => setPickupEnabled(true)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      pickupEnabled === true
                        ? 'bg-emerald-500 border-black'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <Text className={`text-[10px] font-black uppercase ${pickupEnabled ? 'text-white' : 'text-slate-400'}`}>
                      Yes, enable pickup
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setPickupEnabled(false)}
                    className={`flex-1 py-3 rounded-2xl border-2 items-center ${
                      pickupAnswer === true && !pickupEnabled
                        ? 'bg-slate-700 border-slate-600'
                        : 'bg-slate-950 border-slate-800'
                    }`}
                  >
                    <Text className={`text-[10px] font-black uppercase ${pickupAnswer === true && !pickupEnabled ? 'text-white' : 'text-slate-400'}`}>
                      No, dropoff only
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        );

      // ── Step 5: Dry Cleaning ─────────────────────────────────────────────
      case 7:
        return (
          <View className="bg-slate-900 border-2 border-slate-800 rounded-[32px] p-6 shadow-brutalist">
            <View className="flex-row items-center gap-3 mb-5">
              <Percent size={18} color="#86B54F" />
              <Text className="text-white text-[10px] font-black uppercase tracking-widest">
                Sales Tax Collection
              </Text>
            </View>

            <Text className="text-slate-400 text-xs font-bold leading-relaxed mb-4">
              Do you charge sales tax on your services? If so, we'll add it to each
              customer's order and pass it through to you in your payout.
            </Text>

            {/* Yes / No toggle */}
            <View className="flex-row gap-3 mb-4">
              {[{ label: 'Yes, I charge tax', val: true }, { label: "No, I don't", val: false }].map(opt => (
                <TouchableOpacity
                  key={String(opt.val)}
                  onPress={() => setChargesSalesTax(opt.val)}
                  className={`flex-1 p-4 border-2 rounded-2xl items-center ${
                    chargesSalesTax === opt.val ? 'bg-slate-800 border-brand-green/50' : 'bg-slate-950 border-slate-800'
                  }`}
                  activeOpacity={0.8}
                >
                  <Text className={`text-xs font-black uppercase tracking-wider ${
                    chargesSalesTax === opt.val ? 'text-brand-green' : 'text-slate-400'
                  }`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Rate input */}
            {chargesSalesTax === true && (
              <View className="mb-4">
                <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mb-2">Sales Tax Rate (%)</Text>
                <View className="flex-row items-center bg-slate-950 border-2 border-slate-800 rounded-2xl px-4">
                  <TextInput
                    value={salesTaxRate}
                    onChangeText={setSalesTaxRate}
                    placeholder="e.g. 8.625"
                    placeholderTextColor="#475569"
                    keyboardType="decimal-pad"
                    className="flex-1 py-4 font-mono text-white font-bold"
                  />
                  <Text className="text-slate-500 font-black text-base">%</Text>
                </View>
                <Text className="text-slate-600 text-[9px] font-mono uppercase mt-1 ml-1">
                  Enter your combined state + local rate for your jurisdiction
                </Text>
              </View>
            )}

            {/* Responsibility notice */}
            <View className="bg-amber-500/10 border-2 border-amber-500/40 rounded-2xl p-4 mb-4">
              <Text className="text-amber-400 text-[10px] font-black uppercase tracking-wider mb-2">
                Tax Compliance Notice
              </Text>
              <Text className="text-slate-300 text-xs font-bold leading-relaxed">
                The platform collects this sales tax from your customers and passes it
                through to you within your gross revenue. You are solely responsible for
                calculating and remitting the correct state and local sales tax to your
                jurisdiction's Department of Revenue. Please consult a licensed tax
                professional to ensure compliance.
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => setTaxResponsibilityAccepted(!taxResponsibilityAccepted)}
              className={`flex-row items-start gap-3 p-4 border-2 rounded-2xl ${
                taxResponsibilityAccepted ? 'bg-slate-800 border-brand-green/50' : 'bg-slate-900 border-slate-800'
              }`}
              activeOpacity={0.8}
            >
              <View className={`w-6 h-6 rounded border-2 items-center justify-center mt-0.5 flex-shrink-0 ${
                taxResponsibilityAccepted ? 'bg-[#86B54F] border-[#86B54F]' : 'border-slate-600 bg-slate-950'
              }`}>
                {taxResponsibilityAccepted && <Check size={14} color="black" />}
              </View>
              <Text className="text-slate-300 text-xs font-bold flex-1 leading-relaxed">
                I understand I am responsible for remitting any sales tax collected on my behalf.
              </Text>
            </TouchableOpacity>
          </View>
        );

      // ── Step 8: Payouts ──────────────────────────────────────────────────
      // The provider doc was created (onboarded:false) when leaving the tax step,
      // so PayoutSetup can attach a Stripe Connect account here — same flow the
      // Account tab uses. We also capture the payout cadence preference.
      case 9:
        return (
          <View className="items-center">
            {/* Hero icon */}
            <View className="w-28 h-28 bg-[#86B54F] rounded-[32px] border-4 border-black shadow-brutalist items-center justify-center mb-6">
              <CheckCircle size={52} color="black" />
            </View>

            <Text className="text-4xl font-black uppercase tracking-tighter text-white text-center mb-1">
              You're Live!
            </Text>
            <Text className="text-[#86B54F] font-mono text-xs uppercase tracking-widest text-center mb-8">
              Welcome to the Partner Network
            </Text>

            {/* Info cards */}
            {[
              { icon: <Zap size={18} color="#86B54F" />, text: "You're now live on the platform and ready to accept rentals." },
              { icon: <Tags size={18} color="#86B54F" />, text: 'Visit the Promos tab anytime to promote your business to customers in your area.' },
              { icon: <Bell size={18} color="#86B54F" />, text: 'Keep this app running in the background to receive incoming rental requests.' },
            ].map((item, i) => (
              <View key={i} className="flex-row items-center gap-4 bg-slate-900 border-2 border-slate-800 rounded-2xl p-4 mb-3 w-full">
                <View className="w-10 h-10 bg-slate-800 rounded-xl items-center justify-center flex-shrink-0">
                  {item.icon}
                </View>
                <Text className="text-slate-300 text-xs font-bold flex-1 leading-relaxed">{item.text}</Text>
              </View>
            ))}

            {/* CTA */}
            <TouchableOpacity
              onPress={handleFinish}
              disabled={saving}
              className="bg-[#86B54F] py-5 rounded-3xl items-center border-4 border-black shadow-brutalist w-full mt-4"
            >
              {saving ? (
                <ActivityIndicator color="black" />
              ) : (
                <View className="flex-row items-center gap-2">
                  <Text className="text-black font-black uppercase text-base">Enter Command Center</Text>
                  <ArrowRight size={20} color="black" />
                </View>
              )}
            </TouchableOpacity>
          </View>
        );

      default:
        return null;
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-[#020617]"
    >
      {/* ── Fixed Header ── */}
      <View
        className="bg-[#020617] px-6 pb-4 border-b-2 border-slate-900"
        style={{ paddingTop: top + 12 }}
      >
        <Text className="text-[10px] font-mono font-black text-brand-green uppercase tracking-widest mb-1">
          Step {STEP_SEQUENCE.indexOf(step) + 1} of {TOTAL_STEPS} · Partner Setup
        </Text>
        <Text className="text-2xl font-black uppercase tracking-tighter text-white mb-3">
          Partner.<Text className="text-[#86B54F]">Onboarding</Text>
        </Text>

        {/* Progress bar */}
        <View className="flex-row gap-1">
          {STEP_SEQUENCE.map((sn, i) => (
            <View
              key={sn}
              className={`h-1.5 rounded-full flex-1 ${i <= STEP_SEQUENCE.indexOf(step) ? 'bg-[#86B54F]' : 'bg-slate-800'}`}
            />
          ))}
        </View>

        <Text className="text-slate-400 text-[10px] font-black uppercase tracking-wider mt-2">
          {STEP_TITLES[step - 1]}
        </Text>
      </View>

      {/* ── Scrollable Content ── */}
      <ScrollView
        ref={scrollViewRef}
        className="flex-1 px-5 pt-5"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {renderStep()}
      </ScrollView>

      {/* ── Fixed Footer (input steps only; the final welcome step has its own CTA) ── */}
      {STEP_SEQUENCE.indexOf(step) < TOTAL_STEPS - 1 && (
        <View
          className="px-5 pt-4 bg-[#020617] border-t-2 border-slate-900"
          style={{ paddingBottom: bottom + 12 }}
        >
          <TouchableOpacity
            onPress={handleNext}
            disabled={saving}
            className="bg-[#86B54F] py-4 rounded-3xl items-center border-2 border-black shadow-brutalist"
            style={{ opacity: saving ? 0.6 : 1 }}
          >
            {saving ? (
              <ActivityIndicator color="black" />
            ) : (
              <View className="flex-row items-center gap-2">
                <Text className="text-black font-black uppercase text-sm">
                  {STEP_SEQUENCE.indexOf(step) === TOTAL_STEPS - 2 ? 'Final Step' : 'Continue'}
                </Text>
                <ArrowRight size={18} color="black" />
              </View>
            )}
          </TouchableOpacity>

          {STEP_SEQUENCE.indexOf(step) > 0 && (
            <TouchableOpacity
              onPress={handleBack}
              className="flex-row items-center justify-center gap-1 mt-4"
            >
              <ArrowLeft size={14} color="#94a3b8" />
              <Text className="text-slate-400 font-bold text-xs uppercase">Back</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
