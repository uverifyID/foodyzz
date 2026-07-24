import * as admin from 'firebase-admin';
import functionsTest from 'firebase-functions-test';

// Importing the functions module triggers its single admin.initializeApp().
// Keep this the ONLY initializer so admin + fft don't double-init the default app.
import * as fns from '../index';

export const test = functionsTest({ projectId: process.env.GCLOUD_PROJECT || 'demo-foodyzz' });
export const db = admin.firestore();
export { fns, admin };

// ---- auth contexts (mirror what Firebase phone-auth / admin claim put on the token) ----
export function phoneAuth(phoneE164: string) {
  return { uid: phoneE164, token: { phone_number: phoneE164 } } as any;
}
export function adminAuth() {
  return { uid: 'admin-uid', token: { admin: true } } as any;
}

// Invoke a v2 callable with { data, auth }.
export async function callable(fn: any, data: any, auth?: any) {
  const wrapped: any = test.wrap(fn);
  return wrapped({ data, auth });
}

// Invoke a v2 onDocumentCreated trigger for a freshly-created doc.
export async function triggerCreated(fn: any, refPath: string, data: any, params: Record<string, string>) {
  const wrapped: any = test.wrap(fn);
  const snap = test.firestore.makeDocumentSnapshot(data, refPath);
  return wrapped({ data: snap, params });
}

// Invoke a v2 onDocumentUpdated trigger with before/after states.
export async function triggerUpdated(fn: any, refPath: string, before: any, after: any, params: Record<string, string>) {
  const wrapped: any = test.wrap(fn);
  const beforeSnap = test.firestore.makeDocumentSnapshot(before, refPath);
  const afterSnap = test.firestore.makeDocumentSnapshot(after, refPath);
  const change = test.makeChange(beforeSnap, afterSnap);
  return wrapped({ data: change, params });
}

// ---- seeding ----
export async function seedConfig(overrides: any = {}) {
  const { stripe: stripeOverride, secretKey, ...rest } = overrides;
  await db.doc('apiConfig/global').set({
    commissionRate: 0.2,
    commissionRates: 0.2,
    minimumCommission: 5,
    promoCostPerCount: 1,
    deliveryFee: { radius: 5, pickupDelivery: 8 },
    apiKeys: { googleMap: 'test-maps-key' },
    stripe: {
      merchantId: 'acct_test',
      publishableKey: 'pk_test_x',
      transactionFee: 0.3,
      processingFee: 0.029,
      ...(stripeOverride || {}),
    },
    ...rest,
  }, { merge: true });
  // Server-only Stripe secret. Only the payment suite needs a real sk_test key.
  if (secretKey) {
    await db.doc('apiConfigSecret/stripe').set({ secretKey, webSecret: 'whsec_test' }, { merge: true });
  }
}

export async function seedProvider(id: string, data: any = {}) {
  const [phone, zip] = id.split('_');
  await db.doc(`providers/${id}`).set({
    phoneNumber: phone, zipCode: zip, onboarded: true, businessName: 'Test Co',
    salesTaxRate: 0, servicesActive: true, isBlocked: false, ...data,
  }, { merge: true });
}

export async function seedUser(phone: string, data: any = {}) {
  await db.doc(`users/${phone}`).set({ phoneNumber: phone, ...data }, { merge: true });
}

export async function seedOrder(id: string, data: any = {}) {
  await db.doc(`orders/${id}`).set({
    id, customerPhone: '+14025550000', customerName: 'Cust', status: 'requested',
    providerId: 'broadcast', zipCode: '11743', logisticsType: 'dropoff',
    estimatedPrice: 50, orderSubtotal: 40, createdAt: new Date().toISOString(), ...data,
  }, { merge: true });
}

export async function getDoc(path: string): Promise<any> {
  const s = await db.doc(path).get();
  return s.exists ? s.data() : null;
}

// Spy on global fetch so notification sends hit a fake Expo endpoint instead of
// the network. Lets tests assert the outgoing push payload (title/type/sound/
// channelId) without delivering. (Drop-off orders make no Google Maps calls, so
// the only fetch in these paths is Expo.)
export function spyExpo() {
  const spy = jest.spyOn(global as any, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ data: [{ status: 'ok' }] }),
  } as any);
  return {
    spy,
    messages(): any[] {
      return spy.mock.calls
        .filter((c: any) => String(c[0]).includes('exp.host'))
        .flatMap((c: any) => JSON.parse(c[1].body));
    },
    restore() { spy.mockRestore(); },
  };
}

// Wipe the emulator between tests via its REST endpoint (full isolation).
export async function clearFirestore() {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const project = process.env.GCLOUD_PROJECT || 'demo-foodyzz';
  await fetch(`http://${host}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
}
