// Confirming an email address with a 6-digit code, before onboarding accepts it
// and before Account changes it.
//
// The server decides everything that matters (functions/src/emailVerification.ts):
// which domains are accepted, whether a code is right, and the
// users/{phone}.emailVerified stamp, which firestore.rules keeps out of the
// client's reach. The domain list is mirrored here only so a typo is answered
// instantly instead of after a round trip — keep the two in step.
import { getFunctionsInstance } from './firebase';

export const EXACT_DOMAINS = ['gmail.com', 'googlemail.com'];
export const DOMAIN_FAMILIES = /^(yahoo|ymail|outlook|hotmail|live|msn)\.[a-z]{2,4}(\.[a-z]{2,3})?$/;
export const DOMAIN_MESSAGE =
  'Please use a Gmail, Yahoo or Outlook address (gmail.com, yahoo.com, outlook.com, hotmail.com…).';

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed and lower-cased, or null if it isn't shaped like an address. */
export const normalizeEmail = (raw: string | null | undefined): string | null => {
  const email = String(raw ?? '').trim().toLowerCase();
  return EMAIL_SHAPE.test(email) ? email : null;
};

export const isAcceptedDomain = (email: string): boolean => {
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return EXACT_DOMAINS.includes(domain) || DOMAIN_FAMILIES.test(domain);
};

/** The message to show under the field, or null when the address is fine so far. */
export const emailProblem = (raw: string): string | null => {
  const email = normalizeEmail(raw);
  if (!email) return 'Please enter a valid email address.';
  if (!isAcceptedDomain(email)) return DOMAIN_MESSAGE;
  return null;
};

const call = async <T,>(name: string, data: Record<string, unknown>): Promise<T> =>
  (await getFunctionsInstance().httpsCallable(name)(data)).data as T;

export type SendResult = { alreadyVerified: boolean; resendInSec: number };

export const sendEmailCode = (email: string) =>
  call<SendResult>('sendEmailVerificationCode', { email: email.trim() });

export const confirmEmailCode = (email: string, code: string) =>
  call<{ verified: boolean }>('confirmEmailVerificationCode', { email: email.trim(), code: code.trim() });

/** True when the profile already carries a confirmation for exactly this address. */
export const isConfirmed = (profile: any, raw: string): boolean => {
  const email = normalizeEmail(raw);
  return !!email && normalizeEmail(profile?.emailVerified?.email) === email;
};
