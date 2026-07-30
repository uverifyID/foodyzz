import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Image, Linking } from 'react-native';
import { db, subscribeToGlobalConfig, runWithRetry } from '../services/firebase';
import { friendlyError, isExpectedUserError } from '../services/errors';
import authNative from '@react-native-firebase/auth';
import { Phone, ArrowRight, CheckSquare, Square } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: any) => void }) {
  const insets = useSafeAreaInsets();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
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
    if (!phoneNumber || phoneNumber.length < 10) {
      Alert.alert("Invalid Phone", "Please enter a valid phone number with country code.");
      return;
    }
    setLoading(true);
    try {
      // Ensure phone number is strictly E.164 with no spaces or formatting characters
      const raw = phoneNumber.trim().replace(/\D/g, '');
      let sanitizedPhone = '';
      if (phoneNumber.trim().startsWith('+')) {
        sanitizedPhone = `+${raw}`;
      } else {
        sanitizedPhone = `+1${raw}`;
      }
      
      const confirmation = await authNative().signInWithPhoneNumber(sanitizedPhone);
      setConfirm(confirmation);
      Alert.alert("Success", "Verification code sent.");
    } catch (error: any) {
      // A mistyped number is the customer's doing, not a fault: log it quietly so it
      // doesn't raise a LogBox toast over the Alert in dev builds.
      if (isExpectedUserError(error)) {
        if (__DEV__) console.log('[auth] send code rejected:', error?.code);
      } else {
        console.error("Send code error:", error);
      }
      Alert.alert(
        "Could Not Send Code",
        friendlyError(error, 'We could not send a code to that number. Check it and try again.'),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (!verificationCode) return;
    setLoading(true);
    try {
      const userCredential = await confirm.confirm(verificationCode);
      const user = userCredential.user;
      
      if (!user || !user.phoneNumber) {
        throw new Error("Authentication successful but phone number is missing.");
      }

      // Force a token refresh to ensure the Native Firestore module 
      // has the updated auth context and phone_number claim.
      const tokenResult = await user.getIdTokenResult(true);

      // Small buffer to allow the native bridge to propagate 
      // the updated security token to the Firestore service.
      await new Promise(resolve => setTimeout(resolve, 1200));

      const userRef = db.collection('users').doc(user.phoneNumber);

      // Weak signal right after sign-in often drops the first request. Retry the
      // profile read/create a few times with backoff before surfacing an error.
      const snap = await runWithRetry(() => userRef.get());
      if (!snap.exists) {
        await runWithRetry(() => userRef.set({
          phoneNumber: user.phoneNumber,
          onboarded: false,
          createdAt: new Date().toISOString(),
        }));
      }

      onAuthenticated(user);
    } catch (error: any) {
      // Same as above: a wrong 6-digit code is expected input, not an app error.
      if (isExpectedUserError(error)) {
        if (__DEV__) console.log('[auth] verification rejected:', error?.code);
      } else {
        console.error("Verification Error:", error);
      }
      Alert.alert(
        "Verification Failed",
        friendlyError(error, 'We could not verify that code. Request a new one and try again.'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      className="flex-1 bg-white justify-center px-6"
      // Rendered outside the navigator, so nothing above it applies the insets.
      // The content is centred and clears the bars on its own until the keyboard
      // is up and squeezes it — these keep it off them in that state too.
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <View className="items-center mb-10">
        <Image
          source={require('../../assets/images/logo/mainpage/splashscreen.png')}
          style={{ width: 200, height: 200 }}
          resizeMode="contain"
        />
      </View>

      {!confirm ? (
        <View className="space-y-4">
          <View>
            <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">Mobile Number</Text>
            <View className="flex-row items-center bg-slate-50 border-2 border-black rounded-2xl px-4 py-1">
              <Phone size={18} color="#64748b" />
              <TextInput
                value={phoneNumber}
                onChangeText={setPhoneNumber}
                placeholder="+1 555 000 0000"
                keyboardType="phone-pad"
                className="flex-1 h-12 ml-3 font-bold text-black"
              />
            </View>
          </View>
          <TouchableOpacity
            onPress={handleSendCode}
            disabled={loading || !tncAccepted}
            className={`py-5 rounded-3xl items-center shadow-brutalist border-2 border-black ${tncAccepted ? 'bg-black' : 'bg-slate-300'}`}
          >
            {loading ? <ActivityIndicator color="black" /> : (
              <View className="flex-row items-center gap-2">
                <Text className={`font-black uppercase ${tncAccepted ? 'text-white' : 'text-slate-500'}`}>Send Access Code</Text>
                <ArrowRight size={18} color={tncAccepted ? 'white' : '#64748b'} />
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => setTncAccepted(v => !v)} className="flex-row items-start gap-2 px-1 mt-1" activeOpacity={0.7}>
            {tncAccepted ? <CheckSquare size={20} color="#000" /> : <Square size={20} color="#94a3b8" />}
            <Text className="flex-1 text-xs font-bold text-slate-500 leading-relaxed">
              I agree to the{' '}
              <Text className="text-brand-green-dark underline" onPress={openTnc}>Terms &amp; Conditions</Text>.
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View className="space-y-4">
          <View>
            <Text className="text-[10px] font-black text-slate-400 uppercase mb-2 ml-1">6-Digit Verification Code</Text>
            <TextInput
              value={verificationCode}
              onChangeText={setVerificationCode}
              placeholder="000000"
              keyboardType="number-pad"
              maxLength={6}
              className="bg-slate-50 border-2 border-black rounded-2xl p-4 font-black text-center text-2xl tracking-[10px]"
            />
          </View>
          <TouchableOpacity
            onPress={handleVerifyCode}
            disabled={loading}
            className="bg-brand-green py-5 rounded-3xl items-center shadow-brutalist border-2 border-black"
          >
            {loading ? <ActivityIndicator color="black" /> : (
              <Text className="text-black font-black uppercase">Verify & Connect</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setConfirm(null)}>
            <Text className="text-center text-slate-400 font-bold text-xs uppercase underline mt-4">Use different number</Text>
          </TouchableOpacity>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}