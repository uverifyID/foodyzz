// An email field that will not call itself done until a code sent to that address
// comes back. Used at onboarding step 2 and in Account, so both places behave the
// same and the domain rule is stated once.
//
// The parent owns the address and learns about confirmation through
// `onConfirmedChange`; it should refuse to move on while that is false.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CheckCircle, AlertTriangle, Mail } from 'lucide-react-native';
import { friendlyError } from '../services/errors';
import {
  emailProblem, normalizeEmail, sendEmailCode, confirmEmailCode, isConfirmed,
} from '../services/emailVerification';

export default function EmailConfirmField({
  value,
  onChangeText,
  profile,
  onConfirmedChange,
  inputClassName = 'bg-slate-50 border-2 border-black rounded-2xl p-4 font-bold text-black text-base',
  autoFocus,
}: {
  value: string;
  onChangeText: (t: string) => void;
  profile: any;
  onConfirmedChange: (confirmed: boolean) => void;
  inputClassName?: string;
  autoFocus?: boolean;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'send' | 'confirm' | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // Confirmed in this session, for the address it was confirmed for. The profile
  // listener usually catches up a moment later; this keeps the UI from flickering
  // back to "unconfirmed" in between.
  const [justConfirmed, setJustConfirmed] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const normalized = normalizeEmail(value);
  const confirmed = !!normalized && (isConfirmed(profile, value) || justConfirmed === normalized);

  useEffect(() => { onConfirmedChange(confirmed); }, [confirmed, onConfirmedChange]);

  // Resend countdown. Cleared on every change and on unmount, so no timer outlives
  // the screen.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Editing the address invalidates a code sent to the previous one.
  useEffect(() => {
    setSentTo((prev) => (prev && prev !== normalized ? null : prev));
    setError(null);
    if (sentTo && sentTo !== normalized) setCode('');
  }, [normalized]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(async () => {
    const problem = emailProblem(value);
    if (problem) { setError(problem); return; }
    setBusy('send');
    setError(null);
    try {
      const res = await sendEmailCode(value);
      if (!mounted.current) return;
      if (res?.alreadyVerified) {
        setJustConfirmed(normalized);
      } else {
        setSentTo(normalized);
        setCooldown(res?.resendInSec ?? 60);
      }
    } catch (e: any) {
      if (mounted.current) setError(friendlyError(e, 'Could not send the code. Please try again.'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [value, normalized]);

  const confirm = useCallback(async () => {
    setBusy('confirm');
    setError(null);
    try {
      await confirmEmailCode(value, code);
      if (!mounted.current) return;
      setJustConfirmed(normalized);
      setCode('');
    } catch (e: any) {
      if (mounted.current) setError(friendlyError(e, 'Could not confirm that code. Please try again.'));
    } finally {
      if (mounted.current) setBusy(null);
    }
  }, [value, code, normalized]);

  return (
    <View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="jane@gmail.com"
        placeholderTextColor="#94a3b8"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        editable={busy === null}
        className={inputClassName}
      />

      {confirmed ? (
        <View className="flex-row items-center mt-3 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          <CheckCircle size={14} color="#059669" />
          <Text className="ml-2 text-[11px] font-bold text-emerald-700 flex-1">Email confirmed.</Text>
        </View>
      ) : (
        <>
          {!sentTo && (
            <>
              <Text className="text-[11px] font-bold text-slate-400 mt-2 ml-1 leading-relaxed">
                Gmail, Yahoo or Outlook addresses only. We'll send a 6-digit code to confirm it.
              </Text>
              <TouchableOpacity
                onPress={send}
                disabled={busy !== null}
                className="mt-3 bg-brand-green py-3 rounded-xl items-center justify-center border-2 border-black"
                style={{ opacity: busy !== null ? 0.6 : 1 }}
                accessibilityRole="button"
              >
                {busy === 'send' ? <ActivityIndicator size="small" color="#000000" /> : (
                  <View className="flex-row items-center">
                    <Mail size={14} color="#000000" />
                    <Text className="ml-2 text-black font-black uppercase text-[11px] tracking-widest">Send code</Text>
                  </View>
                )}
              </TouchableOpacity>
            </>
          )}

          {!!sentTo && (
            <View className="mt-3">
              <Text className="text-[11px] font-bold text-slate-500 ml-1 leading-relaxed">
                We sent a code to <Text className="font-black text-black">{sentTo}</Text>. Check spam if it isn't there.
              </Text>
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                placeholderTextColor="#94a3b8"
                keyboardType="number-pad"
                maxLength={6}
                editable={busy === null}
                className="bg-slate-50 border-2 border-black rounded-2xl p-4 mt-2 font-black text-black text-xl tracking-[8px] text-center"
              />
              <TouchableOpacity
                onPress={confirm}
                disabled={code.length !== 6 || busy !== null}
                className="mt-3 bg-brand-green py-3 rounded-xl items-center justify-center border-2 border-black"
                style={{ opacity: code.length !== 6 || busy !== null ? 0.6 : 1 }}
                accessibilityRole="button"
              >
                {busy === 'confirm' ? <ActivityIndicator size="small" color="#000000" /> : (
                  <Text className="text-black font-black uppercase text-[11px] tracking-widest">Confirm email</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={send} disabled={cooldown > 0 || busy !== null} className="mt-2 py-2">
                <Text className="text-[10px] font-black uppercase tracking-widest text-center text-slate-500">
                  {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}

      {!!error && (
        <View className="flex-row items-start mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
          <AlertTriangle size={14} color="#dc2626" style={{ marginTop: 1 }} />
          <Text className="ml-2 text-[11px] font-bold text-red-700 flex-1 leading-relaxed">{error}</Text>
        </View>
      )}
    </View>
  );
}
