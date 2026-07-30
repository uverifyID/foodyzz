import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, Image, Linking, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import {
  db,
  subscribeToGlobalConfig,
  runWithRetry,
  preflightHqSignIn,
  redeemHqInvite,
  setActiveProviderId,
  clearActiveProviderId,
  signOutClean,
  type HqPreflight,
} from '../services/firebase';
import authNative from '@react-native-firebase/auth';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckSquare, Square } from 'lucide-react-native';

/**
 * FoodyzzHQ sign-in.
 *
 * The phone proves WHO you are; an invite code, the first time you join a store
 * somebody else created, proves you were meant to. A store used to be identified
 * as `${your phone}_${a zip you typed}`, so it could only ever have one user;
 * membership now lives in providers/{id}/members/{phone} and one store can be run
 * by a whole team.
 *
 * The form asks for the least it can. Most sign-ins are returning members, who
 * need only a number, so the invite field appears only when someone chooses
 * "Join With Code". The zip is not an option at all — it is revealed by preflight
 * when this number belongs to no store yet, which is the only case that needs
 * one. Making that a toggle asked every user, every time, to classify themselves
 * correctly in order to see the right box.
 *
 * The invite is checked BEFORE the SMS goes out (preflightHqSignIn), so an
 * unknown number never costs a verification message. That gate is advisory —
 * enforcement is redeemHqInvite plus firestore.rules — but it is what makes the
 * screen able to tell you "you need an invite" instead of silently dropping you
 * into an empty store, which is what happened before.
 *
 * Returning members need no code at all: preflight sees their membership.
 */
export default function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: any) => void }) {
  // Rendered outside the navigator, so nothing above it applies the insets.
  const insets = useSafeAreaInsets();
  const [phone, setPhone] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [zipCode, setZipCode] = useState('');
  // Which of the two things the person is here to do. Most sign-ins are returning
  // members, who need nothing but a phone number, so the invite field is not shown
  // until someone says they are joining — an input you cannot use is just noise on
  // the screen you see every day.
  const [entry, setEntry] = useState<'signin' | 'invite'>('signin');
  // Set by preflight when this number belongs to no store yet: only then do we ask
  // for a zip, and only to key the store it is about to create. Nobody has to know
  // in advance that "new store" is the case that needs one.
  const [needsZip, setNeedsZip] = useState(false);
  const [verificationCode, setVerificationCode] = useState('');
  const [confirm, setConfirm] = useState<any>(null);
  // What preflight decided for this attempt — carried through to verification so
  // the post-OTP step knows whether to redeem an invite or create a store.
  const [preflight, setPreflight] = useState<HqPreflight | null>(null);
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

  const sanitizePhone = (raw: string) =>
    raw.trim().startsWith('+') ? raw.trim() : `+1${raw.trim().replace(/\D/g, '')}`;

  const handleSendCode = async () => {
    try {
      setLoading(true);
      setError(null);
      if (!phone) {
        setError('Phone number is required.');
        return;
      }
      if (entry === 'invite' && !inviteCode.trim()) {
        setError('Enter the invite code you were given.');
        return;
      }
      if (needsZip && !zipCode.trim()) {
        setError('Enter the zip code of the store you are setting up.');
        return;
      }

      const sanitizedPhone = sanitizePhone(phone);
      const code = inviteCode.trim().toUpperCase();

      // Ask BEFORE spending an SMS. A transport failure here must not lock anyone
      // out of a working app, so it falls through to the legacy behaviour: send
      // the code and let the post-OTP step (and the rules) decide.
      let result: HqPreflight | null = null;
      try {
        result = await preflightHqSignIn(sanitizedPhone, entry === 'invite' ? code : undefined);
      } catch (e: any) {
        if (e?.code === 'functions/resource-exhausted') {
          setError('Too many attempts. Please try again later.');
          return;
        }
        console.warn('Preflight unavailable, continuing:', e?.message);
      }

      if (result && !result.allowed) {
        setError(result.reason === 'invalid_code'
          ? 'That invite code is not valid for this number. Ask your manager for a new one.'
          : 'This number is not set up for FoodyzzHQ. Ask your manager for an invite code.');
        return;
      }

      // Belongs to no store yet, so this sign-in is going to create one — reveal
      // the zip field and stop, rather than spending an SMS we would have to waste.
      // This is why there is no "setting up a new store?" toggle to get wrong: the
      // only person who needs a zip is told so, at the moment it matters.
      if (result?.mode === 'new' && !needsZip) {
        setNeedsZip(true);
        setError('Looks like you are new. Enter the zip code of the store you are setting up.');
        return;
      }

      const confirmation = await authNative().signInWithPhoneNumber(sanitizedPhone);
      setPreflight(result);
      setConfirm(confirmation);
      Alert.alert('Success', 'Verification code sent.');
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

      // Digits of the E.164 number Firebase will actually report — NOT of what was
      // typed, which may be missing the country code.
      const rawDigits = sanitizePhone(phone).replace(/\D/g, '');

      // Whatever store this device was last pointed at belongs to the PREVIOUS
      // session. Stores are shared now, so inheriting it would drop this person
      // into someone else's dashboard.
      await clearActiveProviderId();

      // The store to land on, resolved BEFORE verification wherever possible.
      // confirm.confirm() fires the auth-state change synchronously and App reads
      // the active store id the moment that fires, so it must already be correct —
      // otherwise the onboarding listener subscribes to the wrong store.
      // Null is legitimate for a multi-store member: App resolves it from their
      // memberships instead.
      const resolvedId = needsZip
        ? `${rawDigits}_${zipCode.trim()}`
        : preflight?.providerId ?? null;
      if (resolvedId) await setActiveProviderId(resolvedId);

      await confirm.confirm(verificationCode);
      const user = authNative().currentUser;

      // Joining someone else's store: this is the call that actually writes the
      // membership. It is authenticated, so the phone comes from the verified
      // token rather than anything typed on this screen.
      if (preflight?.mode === 'invite') {
        try {
          const joinedId = await redeemHqInvite(inviteCode.trim().toUpperCase());
          await setActiveProviderId(joinedId);
        } catch (e: any) {
          // Verified, but not a member — leaving them signed in would strand them
          // on a store they cannot read. Undo the session and explain.
          await clearActiveProviderId();
          await signOutClean().catch(() => {});
          setError(e?.message || 'Could not join that store. Please ask your manager for a new invite.');
          return;
        }
      } else if (needsZip && user) {
        // Brand-new store: create the placeholder doc so onboarding has something
        // to write to. onProviderCreatedAddOwner then records the creator as its
        // first member — clients cannot write member docs themselves.
        const providerRef = db.collection('providers').doc(resolvedId!);
        // Weak signal right after sign-in often drops the first request. Retry the
        // store read/create a few times with backoff before surfacing an error.
        const snap = await runWithRetry(() => providerRef.get());
        if (!snap.exists) {
          await runWithRetry(() => providerRef.set({
            phoneNumber: user.phoneNumber?.replace(/\D/g, '') || rawDigits,
            zipCode: zipCode.trim(),
            onboarded: false,
            createdAt: new Date().toISOString(),
          }));
        }
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

  const restart = () => {
    setConfirm(null);
    setPreflight(null);
    setVerificationCode('');
    // Starting over usually means a different number, and needsZip was decided
    // for the old one — leaving it set would demand a zip from someone who
    // already has a store.
    setNeedsZip(false);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-[#020617]"
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: 'center',
          paddingHorizontal: 24,
          // Centred content clears the system bars on its own until the form grows
          // tall enough to scroll; past that the first and last rows would sit
          // under them, so the insets go on the scroll content.
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        }}
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

      {/* Pick the situation first, so the form below only ever shows fields you
          can actually fill in. Hidden once a code has been sent — changing your
          mind at that point means starting over, which the link below already
          does. */}
      {!confirm && (
        <View className="flex-row mb-4">
          {([
            { key: 'signin' as const, label: 'Sign In' },
            { key: 'invite' as const, label: 'Join With Code' },
          ]).map(({ key, label }, i) => (
            <TouchableOpacity
              key={key}
              onPress={() => { setEntry(key); setError(null); }}
              className={`flex-1 p-3 border-2 ${i === 0 ? 'mr-2' : ''} ${
                entry === key ? 'bg-[#86B54F] border-black' : 'bg-slate-900 border-slate-800'
              }`}
            >
              <Text className={`text-center font-black uppercase text-[10px] tracking-wider ${
                entry === key ? 'text-black' : 'text-slate-400'
              }`}>
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <TextInput
        className="border-2 border-slate-800 p-4 mb-4 font-mono text-white bg-slate-900"
        placeholder="Phone Number"
        placeholderTextColor="#475569"
        keyboardType="phone-pad"
        value={phone}
        onChangeText={setPhone}
        editable={!confirm}
      />

      {/* Only for someone joining a store. A returning member signs in with their
          number alone, so this field would be permanently unusable furniture on
          the screen they see most often. */}
      {entry === 'invite' && (
        <TextInput
          className="border-2 border-slate-800 p-4 mb-4 font-mono text-white bg-slate-900 tracking-[3px]"
          placeholder="Invite Code"
          placeholderTextColor="#475569"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          value={inviteCode}
          onChangeText={(t) => setInviteCode(t.toUpperCase())}
          editable={!confirm}
        />
      )}

      {/* Revealed by preflight, never chosen: the only person who needs a zip is
          one whose number belongs to no store yet, and they are told so at the
          moment it applies rather than having to recognise themselves in a label. */}
      {needsZip && (
        <TextInput
          className="border-2 border-[#86B54F] p-4 mb-4 font-mono text-white bg-slate-900"
          placeholder="Store Zip Code"
          placeholderTextColor="#475569"
          keyboardType="numeric"
          value={zipCode}
          onChangeText={setZipCode}
          editable={!confirm}
        />
      )}

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
        <TouchableOpacity onPress={restart}>
          <Text className="text-slate-500 text-center text-[10px] font-bold uppercase">Wrong number or code? Start over</Text>
        </TouchableOpacity>
      )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
