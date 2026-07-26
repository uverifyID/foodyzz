import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, Image, Linking, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { db, subscribeToGlobalConfig, runWithRetry } from '../services/firebase';
import authNative from '@react-native-firebase/auth';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { CheckSquare, Square } from 'lucide-react-native';

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: any) => void }) {
  const [phone, setPhone] = useState('');
  const [zipCode, setZipCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tncAccepted, setTncAccepted] = useState(false);
  const [tncUrl, setTncUrl] = useState<string | null>(null);

  useEffect(() => {
    const unsub = subscribeToGlobalConfig((cfg: any) => setTncUrl(cfg?.legal?.tnc || null));
    return () => unsub();
  }, []);

  const openTnc = () => {
    if (tncUrl) {
      Linking.openURL(tncUrl).catch(() => Alert.alert('Error', 'Could not open Terms & Conditions.'));
    }
  };

  const handleSendCode = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!phone || !zipCode) {
        setError('Phone number and Zip Code are required.');
        setLoading(false);
        return;
      }

      // Format to E.164 (Assuming US default if + is missing)
      const sanitizedPhone = phone.trim().startsWith('+') ? phone.trim() : `+1${phone.trim().replace(/\D/g, '')}`;
      const confirmation = await authNative().signInWithPhoneNumber(sanitizedPhone);
      setConfirm(confirmation);
      Alert.alert("Success", "Verification code sent.");
    } catch (err: any) {
      console.error('Send code error:', err);
      if (err.code?.includes('invalid-phone-number') || err.message?.includes('invalid-phone-number')) {
        setError('Invalid phone number. Please check and try again.');
      } else {
        setError(`Could not send code: ${err.code || err.message || 'unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    try {
      setLoading(true);
      setError(null);

      // Persist the selected zip BEFORE verification completes. confirm.confirm()
      // fires the auth-state change synchronously, and the onboarding listener reads
      // active_provider_zip the moment that fires — so it must already be the new zip,
      // otherwise it would subscribe to the previously-active store's doc.
      await ReactNativeAsyncStorage.setItem('active_provider_zip', zipCode.trim());

      await confirm.confirm(verificationCode);
      const user = authNative().currentUser;
      const rawPhone = user.phoneNumber?.replace(/\D/g, '') || phone.replace(/\D/g, '');

      const providerId = `${rawPhone}_${zipCode.trim()}`;

      const providerRef = db.collection('providers').doc(providerId);

      // Weak signal right after sign-in often drops the first request. Retry the
      // store read/create a few times with backoff before surfacing an error.
      const snap = await runWithRetry(() => providerRef.get());

      if (user && !snap.exists) {
        await runWithRetry(() => providerRef.set({
          phoneNumber: rawPhone,
          zipCode: zipCode.trim(),
          onboarded: false,
          createdAt: new Date().toISOString()
        }));
      }

      onAuthenticated(user);
    } catch (err: any) {
      console.error('Verification error:', err);
      if (err.code === 'auth/invalid-verification-code' || err.message?.includes('invalid-verification-code')) {
        setError('The code entered is incorrect.');
      } else {
        setError(`Verification failed: ${err.code || err.message || 'unknown error'}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-[#020617]"
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
      <View className="mb-8 items-start">
        <Image
          source={require('../../assets/images/logo/mainpage/splashscreen.png')}
          style={{ width: 200, height: 200, marginBottom: 16 }}
          resizeMode="contain"
        />
        <Text className="text-3xl font-black uppercase text-white tracking-tighter">HQ.<Text className="text-[#86B54F]">Partner</Text></Text>
      </View>

      <TextInput
        className="border-2 border-slate-800 p-4 mb-4 font-mono text-white bg-slate-900"
        placeholder="Phone Number"
        placeholderTextColor="#475569"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        editable={!confirm}
      />
      <TextInput
        className="border-2 border-slate-800 p-4 mb-4 font-mono text-white bg-slate-900"
        placeholder="Store Zip Code"
        placeholderTextColor="#475569"
        keyboardType="numeric"
        value={zipCode}
        onChangeText={setZipCode}
        editable={!confirm}
      />

      {confirm && (
        <TextInput
          className="border-2 border-[#86B54F] p-4 mb-4 font-mono text-white bg-slate-900"
          placeholder="Verification Code"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={verificationCode}
          onChangeText={setVerificationCode}
        />
      )}

      {error ? <Text className="text-red-400 mb-4 text-xs font-mono uppercase">{error}</Text> : null}

      <TouchableOpacity
        onPress={confirm ? handleVerifyCode : handleSendCode}
        disabled={loading || (!confirm && !tncAccepted)}
        className={`p-4 border-2 border-black mb-4 shadow-brutalist ${confirm || tncAccepted ? 'bg-[#86B54F]' : 'bg-slate-700'}`}
      >
        {loading ? (
          <ActivityIndicator color="black" />
        ) : (
          <Text className={`text-center font-black uppercase ${confirm || tncAccepted ? 'text-black' : 'text-slate-400'}`}>
            {confirm ? 'Verify SMS Code' : 'Send Verification SMS'}
          </Text>
        )}
      </TouchableOpacity>

      {!confirm && (
        <TouchableOpacity onPress={() => setTncAccepted(v => !v)} className="flex-row items-start gap-2 mb-4 px-1" activeOpacity={0.7}>
          {tncAccepted ? <CheckSquare size={20} color="#86B54F" /> : <Square size={20} color="#475569" />}
          <Text className="flex-1 text-xs font-bold text-slate-400 leading-relaxed">
            I agree to the{' '}
            <Text className="text-[#86B54F] underline" onPress={openTnc}>Terms &amp; Conditions</Text>.
          </Text>
        </TouchableOpacity>
      )}

      {confirm && (
        <TouchableOpacity onPress={() => setConfirm(null)}>
          <Text className="text-slate-500 text-center text-[10px] font-bold uppercase">Wrong number or zip? Start over</Text>
        </TouchableOpacity>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}