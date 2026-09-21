import {
  callable, fns, db, phoneAuth, adminAuth, seedConfig, seedUser, seedOrder, getDoc, clearFirestore, triggerUpdated,
} from './helpers';
import * as cv from '../customerVerification';
import { diditApi, diditSignature, verifyDiditWebhook, resetDiditConfigCache } from '../didit';

const PHONE = '+14025550000';
const WORKFLOW = '11111111-2222-4333-8444-555555555555';
// 350 5th Ave, 10118. ~0.1 mi north is still "at home"; Brooklyn is not.
const HOME = { lat: 40.7484, lng: -73.9857 };
const NEARBY = { lat: 40.7498, lng: -73.9857 };
const FAR = { lat: 40.6782, lng: -73.9442 };

const staffAuth = () => ({ uid: 'staff-uid', token: { hqStaff: true, phone_number: '+19175550100' } } as any);

async function seedCustomer(extra: any = {}) {
  await seedUser(PHONE, {
    name: 'Ada Rider', email: 'ada@example.com', onboarded: true,
    address: '350 5th Ave, New York, NY 10118', zipCode: '10118', ...HOME, ...extra,
  });
}

function decision(status: string, idZip = '10118') {
  return {
    status,
    id_verifications: [{ first_name: 'Ada', last_name: 'Rider', parsed_address: { postal_code: idZip }, formatted_address: `1 Main St, New York, NY ${idZip}` }],
    liveness_checks: [{ score: 97, reference_image: 'https://didit.example/selfie.jpg' }],
    face_matches: [{ score: 91 }],
    ip_analyses: [{ ip_address: '203.0.113.9', country: 'US' }],
  };
}

describe('deriveVerification', () => {
  const user = { address: '350 5th Ave', zipCode: '10118' };
  const key = cv.addressKey(user);

  test('nothing started', () => {
    expect(cv.deriveVerification(null, user, 0.25)).toEqual({
      status: 'action_required', identity: 'not_started', address: 'waiting', location: 'not_started',
    });
  });

  test('Didit approved with a matching ID ZIP and a nearby GPS fix is fully verified', () => {
    const v = cv.deriveVerification({
      didit: { status: 'Approved', idZip: '10118' },
      location: { forAddress: key, distanceMiles: 0.1, capturedAt: 't' },
    }, user, 0.25);
    expect(v).toEqual({ status: 'verified', identity: 'verified', address: 'verified', location: 'verified' });
  });

  test('an ID from another ZIP needs a document; a foreign IP needs a person', () => {
    const v = cv.deriveVerification({
      didit: { status: 'Approved', idZip: '07030' },
      location: { forAddress: key, distanceMiles: 0.1, ipLocation: { countryCode: 'DE' } },
    }, user, 0.25);
    expect(v.address).toBe('needs_document');
    expect(v.location).toBe('in_review');
    // The foreign IP is what holds this one, not the address: a document the
    // customer has not been asked for never decides the overall status.
    expect(v.status).toBe('in_review');
  });

  test('proof of address never holds up the rental', () => {
    // The ID is from another ZIP, so a document is asked for. Identity and the
    // sign-up location are both settled, which is the whole gate — the customer
    // can take the bike, and staff can still chase the document afterwards.
    const v = cv.deriveVerification({
      didit: { status: 'Approved', idZip: '07030' },
      location: { forAddress: key, distanceMiles: 0.1 },
    }, user, 0.25);
    expect(v).toMatchObject({ identity: 'verified', location: 'verified', address: 'needs_document' });
    expect(v.status).toBe('verified');
  });

  test('results recorded for an older address stop applying', () => {
    const v = cv.deriveVerification({
      didit: { status: 'Approved', idZip: '10118' },
      location: { forAddress: 'old|10001', distanceMiles: 0.1 },
      addressReview: { status: 'approved', forAddress: 'old|10001' },
    }, { address: '1 New St', zipCode: '11201' }, 0.25);
    expect(v.address).toBe('needs_document');
    expect(v.location).toBe('not_started');
  });

  test('a staff re-request retires what is already on file', () => {
    const k = {
      didit: { status: 'Approved', idZip: '10118', updatedAt: '2026-09-01T00:00:00.000Z' },
      location: { forAddress: key, distanceMiles: 0.1, capturedAt: 't' },
    };
    expect(cv.deriveVerification(k, user, 0.25)).toMatchObject({ identity: 'verified', address: 'verified' });

    // Asking for a proof of address: the ID's matching ZIP is no longer an answer,
    // so the customer is asked for a document — but the rental is not held for it.
    // Identity and sign-up location are both settled, so the status stays verified.
    const askedAddr = { ...k, requests: { address: { requestedAt: '2026-09-10T00:00:00.000Z' } } };
    expect(cv.deriveVerification(askedAddr, user, 0.25))
      .toMatchObject({ identity: 'verified', address: 'needs_document', status: 'verified' });

    // Asking for the ID again puts the whole ID check back on the customer — and
    // with it the address, which that ID was what proved.
    const askedId = { ...k, requests: { identity: { requestedAt: '2026-09-10T00:00:00.000Z' } } };
    expect(cv.deriveVerification(askedId, user, 0.25))
      .toMatchObject({ identity: 'not_started', address: 'waiting', status: 'action_required' });
  });

  test('a re-request closes itself as soon as the customer sends something newer', () => {
    const asked = { requests: { identity: { requestedAt: '2026-09-10T00:00:00.000Z' }, address: { requestedAt: '2026-09-10T00:00:00.000Z' } } };
    // A document uploaded before staff asked does not count as an answer.
    const stale = {
      ...asked,
      didit: { status: 'Approved', idZip: '10118', updatedAt: '2026-09-01T00:00:00.000Z' },
      addressReview: { status: 'approved', forAddress: key, reviewedAt: '2026-09-02T00:00:00.000Z' },
    };
    expect(cv.deriveVerification(stale, user, 0.25)).toMatchObject({ identity: 'not_started', address: 'needs_document' });

    const fresh = {
      ...asked,
      didit: { status: 'In Review', idZip: '10118', updatedAt: '2026-09-11T00:00:00.000Z' },
      addressReview: { status: 'submitted', forAddress: key, submittedAt: '2026-09-11T00:00:00.000Z' },
    };
    expect(cv.deriveVerification(fresh, user, 0.25)).toMatchObject({ identity: 'in_review', address: 'in_review' });
  });

  test('a staff override passes a location that was too far', () => {
    const k = { location: { forAddress: key, distanceMiles: 3 } };
    expect(cv.deriveVerification(k, user, 0.25).location).toBe('too_far');
    expect(cv.deriveVerification({ ...k, locationReview: { status: 'approved', forAddress: key } }, user, 0.25).location)
      .toBe('verified');
  });
});

describe('Didit webhook signature', () => {
  const body = { session_id: 's1', status: 'Approved', vendor_data: PHONE, score: 12.0, nested: { b: 1, a: 'é' } };
  const now = 1_700_000_000_000;
  test('accepts a fresh signed delivery and rejects tampering or staleness', () => {
    const sig = diditSignature(body, 'whsec');
    expect(verifyDiditWebhook(body, sig, now / 1000, 'whsec', now)).toBe('ok');
    expect(verifyDiditWebhook({ ...body, status: 'Declined' }, sig, now / 1000, 'whsec', now)).toBe('bad_signature');
    expect(verifyDiditWebhook(body, sig, now / 1000 - 3600, 'whsec', now)).toBe('stale');
  });
});

describe('customer verification flow', () => {
  let notify: jest.SpyInstance;
  let email: jest.SpyInstance;
  let createSession: jest.SpyInstance;
  let getDecision: jest.SpyInstance;

  beforeEach(async () => {
    await clearFirestore();
    resetDiditConfigCache();
    await seedConfig({ verification: { required: true, radiusMiles: 0.25 } });
    await db.doc('apiConfigSecret/didit').set({ apiKey: 'k', workflowId: WORKFLOW, webhookSecret: 'whsec' });
    await seedCustomer();
    notify = jest.spyOn(cv.verificationHooks, 'notifyCustomer').mockResolvedValue(undefined);
    email = jest.spyOn(cv.verificationHooks, 'emailAdmin').mockResolvedValue(undefined);
    createSession = jest.spyOn(diditApi, 'createSession')
      .mockResolvedValue({ session_id: 'sess-1', session_token: 'tok', url: 'https://verify.didit.me/x', status: 'Not Started' });
    getDecision = jest.spyOn(diditApi, 'getDecision').mockResolvedValue(decision('Approved'));
    jest.spyOn(diditApi, 'downloadImage').mockResolvedValue(Buffer.from('jpeg'));
    jest.spyOn(cv.kycFiles, 'save').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test('the Rent checkout is refused until verified; Buy is not gated', async () => {
    await expect(callable(fns.createPaymentIntent, {
      orderId: 'o1', providerId: '14025551111_10118', rentalType: 'rent', appVersion: '3.0.0',
    }, phoneAuth(PHONE))).rejects.toThrow(/verification_required/);
    await expect(callable(fns.createPaymentIntent, {
      orderId: 'o1', providerId: '14025551111_10118', rentalType: 'buy', appVersion: '3.0.0',
    }, phoneAuth(PHONE))).rejects.not.toThrow(/verification_required/);
  });

  test('the gate stays open while verification.required is off', async () => {
    await db.doc('apiConfig/global').set({ verification: { required: false } }, { merge: true });
    await expect(cv.assertVerifiedForRental(PHONE)).resolves.toBeUndefined();
  });

  describe('a build too old to show the Verification screen', () => {
    test('is told to update, in words its raw alert can show', async () => {
      // 2.1.0 renders error.message verbatim, so the token must not reach it.
      await expect(cv.assertVerifiedForRental(PHONE, '2.1.0')).rejects.toThrow(/App update required/);
      await expect(cv.assertVerifiedForRental(PHONE, '2.1.0')).rejects.not.toThrow(/verification_required/);
      await expect(cv.assertVerifiedForRental(PHONE)).rejects.toThrow(/App update required/);
    });

    test('a current build still gets the token its checkout catches', async () => {
      await expect(cv.assertVerifiedForRental(PHONE, '3.0.0')).rejects.toThrow(/verification_required/);
      await expect(cv.assertVerifiedForRental(PHONE, '3.1.4')).rejects.toThrow(/verification_required/);
    });

    test('createPaymentIntent passes the version through', async () => {
      const order = { orderId: 'o1', providerId: '14025551111_10118', rentalType: 'rent' };
      await expect(callable(fns.createPaymentIntent, order, phoneAuth(PHONE)))
        .rejects.toThrow(/App update required/);
      await expect(callable(fns.createPaymentIntent, { ...order, appVersion: '3.0.0' }, phoneAuth(PHONE)))
        .rejects.toThrow(/verification_required/);
    });

    test('minAppVersion retires a build without a redeploy', async () => {
      await db.doc('apiConfig/global').set({ verification: { minAppVersion: '3.2.0' } }, { merge: true });
      await expect(cv.assertVerifiedForRental(PHONE, '3.0.0')).rejects.toThrow(/App update required/);
      await expect(cv.assertVerifiedForRental(PHONE, '3.2.0')).rejects.toThrow(/verification_required/);
    });

    test('a typo in minAppVersion is ignored, not obeyed', async () => {
      // Obeying it would tell every customer on every build to go and update.
      await db.doc('apiConfig/global').set({ verification: { minAppVersion: 'v3.0.0' } }, { merge: true });
      await expect(cv.assertVerifiedForRental(PHONE, '3.0.0')).rejects.toThrow(/verification_required/);
      await expect(cv.assertVerifiedForRental(PHONE, '2.1.0')).rejects.toThrow(/App update required/);
    });

    test('a junk version is treated as old', () => {
      expect(cv.versionAtLeast('', '3.0.0')).toBe(false);
      expect(cv.versionAtLeast(undefined, '3.0.0')).toBe(false);
      expect(cv.versionAtLeast('banana', '3.0.0')).toBe(false);
      expect(cv.versionAtLeast('3', '3.0.0')).toBe(true);
      expect(cv.versionAtLeast('2.9.9', '3.0.0')).toBe(false);
      expect(cv.versionAtLeast('10.0.0', '3.0.0')).toBe(true);
    });
  });

  test('too far from the address blocks until staff override it', async () => {
    const loc: any = await callable(fns.recordVerificationLocation, FAR, phoneAuth(PHONE));
    expect(loc.location).toBe('too_far');
    expect(email).toHaveBeenCalledWith(expect.stringMatching(/Sign-up location/), expect.any(String), expect.any(String), expect.any(Array));

    await expect(callable(fns.adminReviewCustomerVerification,
      { phone: PHONE, target: 'location', decision: 'approved' }, phoneAuth(PHONE))).rejects.toThrow(/staff only/i);
    const r: any = await callable(fns.adminReviewCustomerVerification,
      { phone: PHONE, target: 'location', decision: 'approved', note: 'Called them, lives there' }, staffAuth());
    expect(r.verification.location).toBe('verified');
  });

  test('Didit declined → manual licence + selfie and proof of address, approved by staff', async () => {
    getDecision.mockResolvedValue(decision('Declined'));
    await callable(fns.startIdentityVerification, {}, phoneAuth(PHONE));
    await callable(fns.getVerificationStatus, {}, phoneAuth(PHONE));
    expect((await getDoc(`users/${PHONE}`)).verification.identity).toBe('failed');
    expect(notify).toHaveBeenCalledWith(PHONE, expect.any(String), expect.any(String), 'VERIFICATION_DECLINED');

    await expect(callable(fns.submitVerificationDocuments, { target: 'identity' }, phoneAuth(PHONE)))
      .rejects.toThrow(/licence and a selfie/);
    const doc = (p: string) => ({ frontPath: p, uploadedAt: 't', reviewedAt: null });
    await seedUser(PHONE, {
      driverLicense: { ...doc(`driverLicenses/${PHONE}/front-1.jpg`), backPath: `driverLicenses/${PHONE}/back-1.jpg` },
      selfie: doc(`selfies/${PHONE}/front-1.jpg`),
      addressProof: doc(`addressProofs/${PHONE}/front-1.jpg`),
    });
    let r: any = await callable(fns.submitVerificationDocuments, { target: 'identity' }, phoneAuth(PHONE));
    expect(r.verification.identity).toBe('in_review');
    expect(email).toHaveBeenCalledWith(expect.stringMatching(/Identity/), expect.any(String), expect.any(String), expect.any(Array));

    r = await callable(fns.adminReviewCustomerVerification, { phone: PHONE, target: 'identity', decision: 'approved' }, staffAuth());
    expect(r.verification).toMatchObject({ identity: 'verified', address: 'needs_document' });
    const user = await getDoc(`users/${PHONE}`);
    expect(user.driverLicense.reviewedAt).toBeTruthy();
    expect(user.selfie.reviewedAt).toBeTruthy();

    r = await callable(fns.submitVerificationDocuments, { target: 'address' }, phoneAuth(PHONE));
    expect(r.verification.address).toBe('in_review');
    r = await callable(fns.adminReviewCustomerVerification,
      { phone: PHONE, target: 'address', decision: 'rejected', note: 'Bill is older than 90 days.' }, staffAuth());
    expect(r.verification.address).toBe('rejected');
    expect(notify).toHaveBeenCalledWith(PHONE, expect.stringMatching(/Proof of address/),
      expect.stringContaining('older than 90 days'), 'VERIFICATION_REJECTED');
    const status: any = await callable(fns.getVerificationStatus, {}, phoneAuth(PHONE));
    expect(status.notes.address).toBe('Bill is older than 90 days.');
  });

  // The admin console's rental cards: Cancel / Request ID check / Request proof of
  // address. Only the two requests are new here — cancelOrder already existed.
  test('staff can ask a verified renter to redo a check from a rental card', async () => {
    const verifiedAt = '2026-09-01T00:00:00.000Z';
    await db.doc(`customerKyc/${PHONE}`).set({
      phone: PHONE, didit: { status: 'Approved', idZip: '10118', updatedAt: verifiedAt }, updatedAt: verifiedAt,
    });
    await seedOrder('order_v1', { customerPhone: PHONE, status: 'confirmed' });
    await callable(fns.recordVerificationLocation, { ...NEARBY, accuracyM: 12 }, phoneAuth(PHONE));
    expect((await getDoc(`users/${PHONE}`)).verification.status).toBe('verified');

    await expect(callable(fns.adminRequestCustomerVerification,
      { phone: PHONE, target: 'address', orderId: 'order_v1' }, phoneAuth(PHONE))).rejects.toThrow(/staff only/i);
    await expect(callable(fns.adminRequestCustomerVerification,
      { phone: PHONE, target: 'selfie', orderId: 'order_v1' }, staffAuth())).rejects.toThrow(/identity or address/i);

    const r: any = await callable(fns.adminRequestCustomerVerification,
      { phone: PHONE, target: 'address', orderId: 'order_v1', note: 'The ID is from another ZIP.' }, staffAuth());
    // The document is now on the customer's list, but it does not un-verify them:
    // the ID and the sign-up location are what the hand-over is gated on.
    expect(r.verification).toMatchObject({ address: 'needs_document', status: 'verified' });
    expect(notify).toHaveBeenCalledWith(PHONE, expect.stringMatching(/proof of address/i),
      expect.stringContaining('another ZIP'), 'ID_DOCS_REQUESTED');
    // Stamped on the rental the operator was looking at.
    expect((await getDoc('orders/order_v1')).verificationRequests.address)
      .toMatchObject({ requestedBy: '+19175550100', note: 'The ID is from another ZIP.', orderId: 'order_v1' });

    // ...and the customer can act on it: the upload path is open again.
    await seedUser(PHONE, { addressProof: { frontPath: `addressProofs/${PHONE}/front-1.jpg`, uploadedAt: 't', reviewedAt: null } });
    const sub: any = await callable(fns.submitVerificationDocuments, { target: 'address' }, phoneAuth(PHONE));
    expect(sub.verification.address).toBe('in_review');
  });

  test('asking for the ID again lets an approved customer start a new Didit session', async () => {
    await db.doc(`customerKyc/${PHONE}`).set({
      phone: PHONE, didit: { status: 'Approved', idZip: '10118', updatedAt: '2026-09-01T00:00:00.000Z' },
    });
    await expect(callable(fns.startIdentityVerification, {}, phoneAuth(PHONE))).rejects.toThrow(/already_verified/);

    await callable(fns.adminRequestCustomerVerification, { phone: PHONE, target: 'identity' }, staffAuth());
    expect((await getDoc(`users/${PHONE}`)).verification.identity).toBe('not_started');

    await callable(fns.startIdentityVerification, {}, phoneAuth(PHONE));
    expect(createSession).toHaveBeenCalledWith(expect.anything(), PHONE);
    // The new session is newer than the request, so the request has been answered.
    expect((await getDoc(`users/${PHONE}`)).verification.identity).toBe('in_progress');
  });

  test('a re-request is answered by the old document path too', async () => {
    const fire = async (patch: any) => {
      const before = await getDoc(`users/${PHONE}`);
      const after = { ...before, ...patch };
      await db.doc(`users/${PHONE}`).set(after);
      await triggerUpdated(fns.onUserWriteLifecycleEmails, `users/${PHONE}`, before, after, { phone: PHONE });
      return (await getDoc(`users/${PHONE}`)).verification;
    };
    // Verified the old way, then staff ask for the ID again.
    const lic = { frontPath: `driverLicenses/${PHONE}/f.jpg`, backPath: `driverLicenses/${PHONE}/b.jpg`, uploadedAt: 't1', reviewedAt: null, rejectedReason: null };
    await fire({ driverLicense: lic });
    let v = await fire({ driverLicense: { ...lic, reviewedAt: '2026-09-01T00:00:00.000Z', reviewedBy: 'staff' } });
    expect(v.identity).toBe('verified');

    await callable(fns.adminRequestCustomerVerification, { phone: PHONE, target: 'identity' }, staffAuth());
    expect((await getDoc(`users/${PHONE}`)).verification.identity).toBe('not_started');

    // The customer re-uploads from Account → Identity documents, not from the
    // Verification screen. The old path still has to register it.
    v = await fire({ driverLicense: { ...lic, uploadedAt: 't2' } });
    expect(v.identity).toBe('in_review');
    v = await fire({ driverLicense: { ...lic, uploadedAt: 't2', reviewedAt: new Date().toISOString(), reviewedBy: 'staff' } });
    expect(v.identity).toBe('verified');
  });

  test('a late progress event never overwrites a decided session', async () => {
    await callable(fns.startIdentityVerification, {}, phoneAuth(PHONE));
    await cv.applyDiditResult(PHONE, 'sess-1', 'Approved', decision('Approved'));
    await cv.applyDiditResult(PHONE, 'sess-1', 'In Progress', null);
    expect((await getDoc(`customerKyc/${PHONE}`)).didit.status).toBe('Approved');
    await expect(callable(fns.startIdentityVerification, {}, phoneAuth(PHONE))).rejects.toThrow(/already_verified/);
  });

  test('changing the delivery address sends address and location back to the customer', async () => {
    await callable(fns.startIdentityVerification, {}, phoneAuth(PHONE));
    await cv.applyDiditResult(PHONE, 'sess-1', 'Approved', decision('Approved'));
    await callable(fns.recordVerificationLocation, NEARBY, phoneAuth(PHONE));
    const before = await getDoc(`users/${PHONE}`);
    expect(before.verification.status).toBe('verified');

    const after = { ...before, address: '1 Court St, Brooklyn, NY 11201', zipCode: '11201', ...FAR };
    await db.doc(`users/${PHONE}`).set(after);
    await triggerUpdated(fns.onUserWriteLifecycleEmails, `users/${PHONE}`, before, after, { phone: PHONE });
    expect((await getDoc(`users/${PHONE}`)).verification).toMatchObject({
      status: 'action_required', identity: 'verified', address: 'needs_document', location: 'not_started',
    });
  });

  test('fallback: the existing manual document process feeds verification', async () => {
    const fire = async (patch: any) => {
      const before = await getDoc(`users/${PHONE}`);
      const after = { ...before, ...patch };
      await db.doc(`users/${PHONE}`).set(after);
      await triggerUpdated(fns.onUserWriteLifecycleEmails, `users/${PHONE}`, before, after, { phone: PHONE });
      return (await getDoc(`users/${PHONE}`)).verification;
    };
    const lic = { frontPath: `driverLicenses/${PHONE}/f.jpg`, backPath: `driverLicenses/${PHONE}/b.jpg`, uploadedAt: 't1', reviewedAt: null, rejectedReason: null };
    const poa = { frontPath: `addressProofs/${PHONE}/a.jpg`, uploadedAt: 't1', reviewedAt: null, rejectedReason: null };

    // Customer uploads the set from Account → straight into the review queue.
    let v = await fire({ driverLicense: lic, addressProof: poa });
    expect(v).toMatchObject({ identity: 'in_review', address: 'in_review' });

    // FoodyzzHQ order card / console Licenses tab rejects it: one push (the existing
    // ID_DOCS_REJECTED), not a second one from verification.
    notify.mockClear();
    v = await fire({ driverLicense: { ...lic, rejectedReason: 'Blurry' }, addressProof: { ...poa, rejectedReason: 'Blurry' } });
    expect(v).toMatchObject({ identity: 'rejected', address: 'rejected' });
    expect(notify).not.toHaveBeenCalledWith(PHONE, expect.anything(), expect.anything(), 'VERIFICATION_REJECTED');

    // Re-upload, then staff approve the set the old way (reviewedAt on the maps).
    await fire({ driverLicense: { ...lic, uploadedAt: 't2' }, addressProof: { ...poa, uploadedAt: 't2' } });
    v = await fire({
      driverLicense: { ...lic, uploadedAt: 't2', reviewedAt: 'now', reviewedBy: '14025551111_10118' },
      addressProof: { ...poa, uploadedAt: 't2', reviewedAt: 'now', reviewedBy: '14025551111_10118' },
    });
    expect(v).toMatchObject({ identity: 'verified', address: 'verified', location: 'not_started' });
    const kyc = await getDoc(`customerKyc/${PHONE}`);
    expect(kyc.identityReview).toMatchObject({ status: 'approved', source: 'documents' });
    expect(kyc.identityReview.note).toBeUndefined();

    // Location still has to be checked — documents can't prove it.
    await callable(fns.recordVerificationLocation, NEARBY, phoneAuth(PHONE));
    expect((await getDoc(`users/${PHONE}`)).verification.status).toBe('verified');
  });

  test('staff can read a customer record; customers cannot', async () => {
    await callable(fns.recordVerificationLocation, NEARBY, phoneAuth(PHONE));
    await expect(callable(fns.adminGetCustomerVerification, { phone: PHONE }, phoneAuth(PHONE))).rejects.toThrow(/staff only/i);
    const r: any = await callable(fns.adminGetCustomerVerification, { phone: PHONE }, adminAuth());
    expect(r.kyc.location.distanceMiles).toBeCloseTo(0.097, 2);
    expect(r.kyc.limits).toBeUndefined();
  });
});
