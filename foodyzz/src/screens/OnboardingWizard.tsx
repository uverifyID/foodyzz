import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert,
  KeyboardAvoidingView, Platform, ScrollView
} from 'react-native';
import { db, signOutClean, getFunctionsInstance } from '../services/firebase';
import { geocodeAddress } from '../services/geo';
import { User, Mail, MapPin, Hash, ArrowRight, ArrowLeft, Check } from 'lucide-react-native';
import { UserProfile } from '../types';
import AddressAutocomplete from '../components/AddressAutocomplete';

// One-step-at-a-time profile onboarding. Shown whenever the user's Firestore
// document has `onboarded !== true`. On completion it writes the collected
// fields plus `onboarded: true`; App.tsx's profile listener then swaps to the
// main app automatically.
const TOTAL_STEPS = 4;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function OnboardingWizard({
  user,
  profile,
  onComplete,
}: {
  user: { phoneNumber: string | null };
  profile?: Partial<UserProfile> | null;
  onComplete?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);

  // Google Maps key for the Places-backed address field (mirrors the scrubshq
  // provider onboarding). Loaded once from public app config.
  const [apiKey, setApiKey] = useState<string | undefined>(undefined);
  useEffect(() => {
    db.collection('apiConfig').doc('global').get()
      .then(snap => setApiKey(snap.data()?.apiKeys?.googleMap))
      .catch(() => {});
  }, []);

  // Prefill from any existing profile data so returning users (created before
  // the onboarding flag existed) don't lose what they already entered.
  const [name, setName] = useState(profile?.name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [address, setAddress] = useState(profile?.address || '');
  const [zipCode, setZipCode] = useState(profile?.zipCode || '');
  // Optional referral code from an ambassador (captured at the zip step).

  const validateCurrentStep = (): string | null => {
    switch (step) {
      case 1:
        if (!name.trim()) return 'Please enter your full name.';
        return null;
      case 2:
        if (!EMAIL_REGEX.test(email.trim())) return 'Please enter a valid email address.';
        return null;
      case 3:
        if (!address.trim()) return 'Please enter your street address.';
        return null;
      case 4:
        if (!/^\d{5}$/.test(zipCode.trim())) return 'Please enter a valid 5-digit zip code.';
        return null;
      default:
        return null;
    }
  };

  const handleNext = () => {
    const error = validateCurrentStep();
    if (error) {
      Alert.alert('Missing Detail', error);
      return;
    }
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleFinish = async () => {
    if (!user?.phoneNumber) {
      // Orphaned auth session (valid Firebase Auth but no phone) — the user can't
      // escape this on their own, so sign them out and route back to the auth
      // screen. onAuthStateChanged in App handles the redirect.
      Alert.alert('Session Expired', 'Please sign in again to continue.', [
        { text: 'OK', onPress: () => signOutClean().catch(() => {}) },
      ]);
      return;
    }
    setSaving(true);

    let lat: number | null = null;
    let lng: number | null = null;
    try {
      const configSnap = await db.collection('apiConfig').doc('global').get();
      const apiKey: string | undefined = configSnap.data()?.apiKeys?.googleMap;
      if (apiKey && address.trim()) {
        const coords = await geocodeAddress(address.trim(), apiKey);
        if (!coords) {
          Alert.alert(
            'Address Not Found',
            "We couldn't verify that address. Please enter a full street address including city and state.",
          );
          setSaving(false);
          return;
        }
        lat = coords.lat;
        lng = coords.lng;
      }
    } catch {
      // Config fetch failed — skip validation and proceed without coordinates.
      console.warn('OnboardingWizard: could not fetch apiConfig, skipping address validation');
    }

    try {
      // merge so we never clobber fields like fcmToken / createdAt on the doc.
      await db.collection('users').doc(user.phoneNumber).set(
        {
          phoneNumber: user.phoneNumber,
          name: name.trim(),
          email: email.trim(),
          address: address.trim(),
          zipCode: zipCode.trim(),
          ...(lat !== null && lng !== null ? { lat, lng } : {}),
          onboarded: true,
        },
        { merge: true }
      );
      onComplete?.();
    } catch (error: any) {
      console.error('Onboarding save error:', error);
      Alert.alert('Save Failed', error.message || 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const renderStepContent = () => {
    switch (step) {
      case 1:
        return (
          <StepField
            icon={<User size={22} color="#507425" />}
            label="Full Name"
            helper="What should we call you?"
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            autoCapitalize="words"
          />
        );
      case 2:
        return (
          <StepField
            icon={<Mail size={22} color="#507425" />}
            label="Email Address"
            helper="We'll send rental receipts and updates here."
            value={email}
            onChangeText={setEmail}
            placeholder="jane@email.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />
        );
      case 3:
        return (
          <View>
            <View className="flex-row items-center gap-3 mb-2">
              <MapPin size={22} color="#507425" />
              <Text className="text-xl font-black uppercase tracking-tighter">Street Address</Text>
            </View>
            <Text className="text-xs font-bold text-slate-400 mb-6">
              Where should your bike be delivered? Pick your verified address.
            </Text>
            <AddressAutocomplete
              value={address}
              onSelect={setAddress}
              apiKey={apiKey}
              placeholder="123 Main St, Apt 4B"
              inputClassName="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black text-base"
            />
          </View>
        );
      case 4:
        return (
          <View>
            <StepField
              icon={<Hash size={22} color="#507425" />}
              label="Zip Code"
              helper="Used to match you with the nearest FoodyzzHQ location."
              value={zipCode}
              onChangeText={setZipCode}
              placeholder="10025"
              keyboardType="number-pad"
              maxLength={5}
            />
          </View>
        );
      default:
        return null;
    }
  };

  const isFinalStep = step === TOTAL_STEPS;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'space-between' }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        className="px-6 pt-16"
      >
        <View>
          {/* Header + progress */}
          <View className="mb-8">
            <Text className="text-[10px] font-mono font-black text-indigo-500 uppercase tracking-widest mb-1">
              Step {step} of {TOTAL_STEPS} · Profile Setup
            </Text>
            <Text className="text-3xl font-black uppercase tracking-tighter">
              Complete.<Text className="text-brand-green-dark">Profile</Text>
            </Text>
            <View className="flex-row gap-2 mt-5">
              {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
                <View
                  key={i}
                  className={`flex-1 h-2 rounded-full border-2 border-black ${
                    i < step ? 'bg-brand-green' : 'bg-slate-100'
                  }`}
                />
              ))}
            </View>
          </View>

          {/* Active step */}
          <View className="bg-white border-2 border-black rounded-[32px] p-6 shadow-brutalist">
            {renderStepContent()}
          </View>
        </View>

        {/* Footer controls */}
        <View className="py-8">
          <TouchableOpacity
            onPress={handleNext}
            disabled={saving}
            className="bg-black py-5 rounded-3xl items-center shadow-brutalist border-2 border-black"
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <View className="flex-row items-center gap-2">
                <Text className="text-white font-black uppercase">
                  {isFinalStep ? 'Finish & Enter App' : 'Continue'}
                </Text>
                {isFinalStep ? <Check size={18} color="white" /> : <ArrowRight size={18} color="white" />}
              </View>
            )}
          </TouchableOpacity>

          <View className="flex-row justify-between items-center mt-5">
            {step > 1 ? (
              <TouchableOpacity onPress={handleBack} disabled={saving} className="flex-row items-center gap-1">
                <ArrowLeft size={14} color="#94a3b8" />
                <Text className="text-slate-400 font-bold text-xs uppercase">Back</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}

          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

// Single labelled input used by the simple (one-field) steps.
function StepField({
  icon,
  label,
  helper,
  ...inputProps
}: {
  icon: React.ReactNode;
  label: string;
  helper: string;
} & React.ComponentProps<typeof TextInput>) {
  return (
    <View>
      <View className="flex-row items-center gap-3 mb-2">
        {icon}
        <Text className="text-xl font-black uppercase tracking-tighter">{label}</Text>
      </View>
      <Text className="text-xs font-bold text-slate-400 mb-6">{helper}</Text>
      <TextInput
        placeholderTextColor="#cbd5e1"
        className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black text-base"
        {...inputProps}
      />
    </View>
  );
}
