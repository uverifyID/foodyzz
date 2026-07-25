import React, { useState } from 'react';
import { MultiFactorResolver, TotpMultiFactorGenerator } from 'firebase/auth';

/**
 * Second-factor challenge shown mid-login when the account has TOTP MFA enrolled.
 * Firebase throws `auth/multi-factor-auth-required` from signInWithEmailAndPassword;
 * App resolves it into a MultiFactorResolver and hands it here. Until the code is
 * verified the user is NOT signed in — this enforces 2FA at the auth layer, not the UI.
 */
export default function MfaChallenge({ resolver, onCancel }: {
  resolver: MultiFactorResolver;
  onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const totpHint = resolver.hints.find(h => h.factorId === TotpMultiFactorGenerator.FACTOR_ID);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpHint) { setError('No authenticator is set up for this account.'); return; }
    setBusy(true); setError('');
    try {
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, code.trim());
      await resolver.resolveSignIn(assertion);
      // Success → onAuthStateChanged in App takes over and renders the console.
    } catch (err: any) {
      const invalid = err?.code === 'auth/invalid-verification-code' || err?.code === 'auth/missing-code';
      setError(invalid
        ? 'That code was not valid. Enter the current 6-digit code from your authenticator.'
        : (err?.message || 'Verification failed. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-stone-100">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src={`${process.env.PUBLIC_URL}/images/mainpage/splashscreen.png`} alt="Foodyzz" className="h-20 w-auto border-4 border-black shadow-brutalist inline-block mb-4" />
          <h1 className="font-black uppercase tracking-tighter text-2xl">Two-Factor Auth</h1>
          <p className="text-stone-500 text-xs font-mono uppercase mt-1">Enter your authenticator code</p>
        </div>
        <form onSubmit={submit} className="bg-white border-4 border-black shadow-brutalist p-8 space-y-4">
          <div>
            <label className="font-black uppercase text-[10px] tracking-widest text-stone-500 block mb-1">6-digit code</label>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              maxLength={6}
              placeholder="000000"
              className="w-full border-2 border-black px-3 py-2 font-mono text-lg tracking-[0.4em] text-center focus:outline-none focus:border-brand-green"
            />
          </div>
          {error && <p className="text-red-500 text-xs font-bold font-mono">{error}</p>}
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full bg-black text-white font-black uppercase text-sm py-3 border-2 border-black shadow-brutalist hover:shadow-none hover:translate-x-1 hover:translate-y-1 transition-all disabled:opacity-50"
          >
            {busy ? 'Verifying…' : 'Verify →'}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="w-full font-black uppercase text-xs text-stone-500 hover:text-rose-600 py-1"
          >
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
