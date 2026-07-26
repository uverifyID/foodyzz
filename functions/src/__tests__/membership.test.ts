import {
  callable, triggerCreated, fns, seedConfig, seedProvider, seedOrder,
  db, getDoc, clearFirestore, spyExpo, phoneAuth, adminAuth, test as fft,
} from './helpers';

// A store's doc id names whoever CREATED it. These tests are about the second
// person: someone whose phone is nowhere in that id being able to work the store.
const STORE = '14025551111_11743';
const OWNER = '+14025551111';
const STAFF = '+14025559999';
const STRANGER = '+14025558888';

// onDocumentDeleted harness: the trigger receives the doc as it last existed.
async function triggerDeleted(fn: any, refPath: string, data: any, params: Record<string, string>) {
  const wrapped: any = fft.wrap(fn);
  return wrapped({ data: fft.firestore.makeDocumentSnapshot(data, refPath), params });
}

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function seedInvite(code: string, data: any = {}) {
  await db.doc(`invites/${code}`).set({
    phone: STAFF,
    providerId: STORE,
    role: 'staff',
    used: false,
    createdAt: new Date().toISOString(),
    expiresAt: inDays(14),
    ...data,
  });
}

beforeEach(async () => {
  await clearFirestore();
  await seedConfig();
});

describe('onProviderCreatedAddOwner', () => {
  test('records the creator as the first member of a new store', async () => {
    await triggerCreated(
      fns.onProviderCreatedAddOwner,
      `providers/${STORE}`,
      { phoneNumber: '14025551111', zipCode: '11743', onboarded: false },
      { providerId: STORE },
    );
    expect(await getDoc(`providers/${STORE}/members/${OWNER}`))
      .toMatchObject({ phone: OWNER, role: 'owner' });
  });

  test('falls back to the doc-id prefix when the doc omits phoneNumber', async () => {
    // Legacy/partial docs exist; without the fallback their owner would end up
    // with no member record and no way to write to their own store.
    await triggerCreated(
      fns.onProviderCreatedAddOwner,
      `providers/${STORE}`,
      { zipCode: '11743' },
      { providerId: STORE },
    );
    expect(await getDoc(`providers/${STORE}/members/${OWNER}`)).toMatchObject({ role: 'owner' });
  });
});

describe('orphaned memberships (deleted store)', () => {
  // Deleting a provider leaves its members behind — Firestore has no cascade, and
  // rules make members server-only so the app cannot clean up after itself. An
  // orphan resolves as the active store, whose document does not exist, which the
  // app reads as "not onboarded" → the onboarding wizard, every launch, forever.
  test('a membership pointing at a deleted store is ignored by preflight', async () => {
    await db.doc(`providers/${STORE}/members/${STAFF}`)
      .set({ phone: STAFF, role: 'owner', addedAt: new Date().toISOString() });
    // No providers/{STORE} doc at all — exactly the state a purge leaves behind.
    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF });
    expect(res.mode).not.toBe('member');
    expect(res).toMatchObject({ mode: 'new', providerId: null });
  });

  test('live stores still resolve when a dead one sits alongside', async () => {
    await seedProvider(STORE);
    await db.doc(`providers/${STORE}/members/${STAFF}`)
      .set({ phone: STAFF, role: 'staff', addedAt: new Date().toISOString() });
    await db.doc(`providers/99999999999_dead/members/${STAFF}`)
      .set({ phone: STAFF, role: 'owner', addedAt: new Date().toISOString() });

    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF });
    // storeCount must not count the ghost, or the app shows a picker for one store.
    expect(res).toMatchObject({ mode: 'member', providerId: STORE, storeCount: 1 });
  });

  test('deleting a store removes its members', async () => {
    await seedProvider(STORE);
    await db.doc(`providers/${STORE}/members/${STAFF}`)
      .set({ phone: STAFF, role: 'staff', addedAt: new Date().toISOString() });

    await triggerDeleted(fns.onProviderDeletedCleanupMembers, `providers/${STORE}`,
      { phoneNumber: '14025551111' }, { providerId: STORE });

    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).toBeNull();
  });
});

describe('redeemHqInvite', () => {
  beforeEach(async () => {
    await seedProvider(STORE);
  });

  test('joins the invited phone to the store and spends the code', async () => {
    await seedInvite('A7K2M9QP', { name: 'Sam', createdBy: OWNER });
    const res: any = await callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF));

    expect(res.providerId).toBe(STORE);
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`))
      .toMatchObject({ phone: STAFF, role: 'staff', name: 'Sam', invitedBy: OWNER });
    expect(await getDoc('invites/A7K2M9QP')).toMatchObject({ used: true });
  });

  test('refuses a code issued to a different phone', async () => {
    await seedInvite('A7K2M9QP');
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STRANGER)))
      .rejects.toThrow(/different phone/i);
    expect(await getDoc(`providers/${STORE}/members/${STRANGER}`)).toBeNull();
    // The code must survive an attempt by the wrong person, or a stranger could
    // burn someone else's invite just by guessing it.
    expect(await getDoc('invites/A7K2M9QP')).toMatchObject({ used: false });
  });

  test('refuses an expired code', async () => {
    await seedInvite('A7K2M9QP', { expiresAt: inDays(-1) });
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF)))
      .rejects.toThrow(/expired/i);
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).toBeNull();
  });

  test('refuses a revoked code', async () => {
    await seedInvite('A7K2M9QP', { revokedAt: new Date().toISOString() });
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF)))
      .rejects.toThrow(/already been used/i);
  });

  test('is single-use: a second, different phone cannot reuse a spent code', async () => {
    await seedInvite('A7K2M9QP');
    await callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF));
    // Bound to STAFF, so this is refused on the phone check before "already used"
    // even matters — belt and braces.
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STRANGER)))
      .rejects.toThrow();
    expect(await getDoc(`providers/${STORE}/members/${STRANGER}`)).toBeNull();
  });

  test('is idempotent for the SAME phone retrying after a dropped response', async () => {
    await seedInvite('A7K2M9QP');
    const first: any = await callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF));
    const second: any = await callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF));
    expect(second.providerId).toBe(first.providerId);
  });

  test('refuses when the store no longer exists', async () => {
    await db.doc(`providers/${STORE}`).delete();
    await seedInvite('A7K2M9QP');
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF)))
      .rejects.toThrow(/no longer exists/i);
  });

  test('requires sign-in', async () => {
    await seedInvite('A7K2M9QP');
    await expect(callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, undefined))
      .rejects.toThrow(/sign in/i);
  });

  test('rejects a malformed code without touching Firestore', async () => {
    await expect(callable(fns.redeemHqInvite, { code: 'nope' }, phoneAuth(STAFF)))
      .rejects.toThrow(/not valid/i);
  });
});

describe('preflightHqSignIn', () => {
  test('lets an existing member back in with no code at all', async () => {
    await seedProvider(STORE);
    await db.doc(`providers/${STORE}/members/${STAFF}`).set({ phone: STAFF, role: 'staff', addedAt: new Date().toISOString() });

    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF });
    expect(res).toMatchObject({ allowed: true, mode: 'member', providerId: STORE, storeCount: 1 });
  });

  test('leaves providerId null when the member belongs to several stores', async () => {
    await seedProvider(STORE);
    await seedProvider('14025552222_10001');
    for (const id of [STORE, '14025552222_10001']) {
      await db.doc(`providers/${id}/members/${STAFF}`).set({ phone: STAFF, role: 'staff', addedAt: new Date().toISOString() });
    }
    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF });
    expect(res).toMatchObject({ allowed: true, mode: 'member', providerId: null, storeCount: 2 });
  });

  test('an EXISTING store owner can still accept an invite to another store', async () => {
    // The order of these two checks is the whole test. Membership-first would send
    // this person back to their own store and quietly ignore the code — invisible,
    // because they land somewhere that looks right.
    await seedProvider(STORE);
    await seedProvider('15167290269_14');
    await db.doc(`providers/15167290269_14/members/${STAFF}`)
      .set({ phone: STAFF, role: 'owner', addedAt: new Date().toISOString() });
    await seedInvite('A7K2M9QP');

    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF, code: 'A7K2M9QP' });
    expect(res).toMatchObject({ allowed: true, mode: 'invite', providerId: STORE });

    // ...and the redemption puts them in BOTH, rather than moving them.
    await callable(fns.redeemHqInvite, { code: 'A7K2M9QP' }, phoneAuth(STAFF));
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).toMatchObject({ role: 'staff' });
    expect(await getDoc(`providers/15167290269_14/members/${STAFF}`)).toMatchObject({ role: 'owner' });
  });

  test('resolves the target store from a valid invite, before any SMS', async () => {
    await seedProvider(STORE);
    await seedInvite('A7K2M9QP');
    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF, code: 'A7K2M9QP' });
    expect(res).toMatchObject({ allowed: true, mode: 'invite', providerId: STORE });
  });

  test('refuses a code that belongs to someone else, without saying so', async () => {
    await seedProvider(STORE);
    await seedInvite('A7K2M9QP');
    const res: any = await callable(fns.preflightHqSignIn, { phone: STRANGER, code: 'A7K2M9QP' });
    // Same undifferentiated reason as a nonexistent code — anything more would
    // confirm the code is real.
    expect(res).toMatchObject({ allowed: false, reason: 'invalid_code' });
  });

  test('refuses an unknown code', async () => {
    const res: any = await callable(fns.preflightHqSignIn, { phone: STAFF, code: 'ZZZZZZZZ' });
    expect(res).toMatchObject({ allowed: false, reason: 'invalid_code' });
  });

  test('recognises a legacy owner whose member doc has not been backfilled', async () => {
    await seedProvider(STORE); // no members subcollection
    const res: any = await callable(fns.preflightHqSignIn, { phone: OWNER });
    expect(res).toMatchObject({ allowed: true, mode: 'owner', providerId: STORE });
  });

  test('allows a brand-new store signup by default', async () => {
    const res: any = await callable(fns.preflightHqSignIn, { phone: STRANGER });
    expect(res).toMatchObject({ allowed: true, mode: 'new', providerId: null });
  });

  test('closes new signups when hq.requireInviteToSignIn is set', async () => {
    await seedConfig({ hq: { requireInviteToSignIn: true } });
    // apiConfig is cached for 60s per warm instance (deliberately — preflight is
    // unauthenticated, so it must not cost a Firestore read per attempt). Step the
    // clock past the TTL so this test sees the flag rather than a stale copy;
    // in production the switch takes effect within a minute for the same reason.
    const realNow = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(realNow + 61_000);
    try {
      const res: any = await callable(fns.preflightHqSignIn, { phone: STRANGER });
      expect(res).toMatchObject({ allowed: false, reason: 'invite_required' });
    } finally {
      clock.mockRestore();
    }
  });

  test('rate-limits repeated attempts on one number', async () => {
    // Unauthenticated by necessity (it runs before the SMS), so this is the one
    // surface a stranger can hammer. 12/hour per phone.
    const attempt = () => callable(fns.preflightHqSignIn, { phone: STRANGER, code: 'ZZZZZZZZ' });
    for (let i = 0; i < 12; i++) await attempt();
    await expect(attempt()).rejects.toThrow(/too many/i);
  });

  test('rejects junk instead of treating it as a phone number', async () => {
    await expect(callable(fns.preflightHqSignIn, { phone: '123' })).rejects.toThrow(/valid phone/i);
  });
});

describe('multi-device push (one store, several members)', () => {
  test('a direct order reaches EVERY member device, badged once', async () => {
    await seedProvider(STORE, {
      fcmTokens: ['ExponentPushToken[OWNER]', 'ExponentPushToken[STAFF]'],
      badgeCount: 3,
    });
    const expo = spyExpo();
    await seedOrder('d1', { providerId: STORE, zipCode: '11743' });
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/d1',
      { id: 'd1', providerId: STORE, zipCode: '11743', status: 'requested', createdAt: new Date().toISOString() },
      { orderId: 'd1' });
    const msgs = expo.messages();
    expo.restore();

    expect(msgs.map((m) => m.to).sort())
      .toEqual(['ExponentPushToken[OWNER]', 'ExponentPushToken[STAFF]']);
    // The badge counts unread ORDERS for the store, so every device shows 4 —
    // not 4 and 5 from two independent increments.
    expect(msgs.every((m) => m.badge === 4)).toBe(true);
    expect((await getDoc(`providers/${STORE}`)).badgeCount).toBe(4);
  });

  test('a device still on the old build keeps receiving, and is not double-sent', async () => {
    // During rollout one device writes both fields; the union must dedupe.
    await seedProvider(STORE, {
      fcmToken: 'ExponentPushToken[LEGACY]',
      fcmTokens: ['ExponentPushToken[LEGACY]', 'ExponentPushToken[NEW]'],
    });
    const expo = spyExpo();
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/d2',
      { id: 'd2', providerId: STORE, zipCode: '11743', status: 'requested', createdAt: new Date().toISOString() },
      { orderId: 'd2' });
    const msgs = expo.messages();
    expo.restore();

    expect(msgs.map((m) => m.to).sort())
      .toEqual(['ExponentPushToken[LEGACY]', 'ExponentPushToken[NEW]']);
  });

  test('a dead token is pruned without unregistering the store\'s other devices', async () => {
    await seedProvider(STORE, {
      fcmToken: 'ExponentPushToken[LIVE]',
      fcmTokens: ['ExponentPushToken[LIVE]', 'ExponentPushToken[DEAD]'],
    });
    const spy = jest.spyOn(global as any, 'fetch').mockImplementation(async (_url: any, init: any) => {
      const sent = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          data: sent.map((m: any) => m.to.includes('DEAD')
            ? { status: 'error', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: 'ticket' }),
        }),
      } as any;
    });
    await triggerCreated(fns.onOrderCreatedNotify, 'orders/d3',
      { id: 'd3', providerId: STORE, zipCode: '11743', status: 'requested', createdAt: new Date().toISOString() },
      { orderId: 'd3' });
    spy.mockRestore();

    const after = await getDoc(`providers/${STORE}`);
    expect(after.fcmTokens).toEqual(['ExponentPushToken[LIVE]']);
    // The legacy scalar belongs to the LIVE device here — clearing it (as the old
    // blunt cleanup did) would have silenced a working phone.
    expect(after.fcmToken).toBe('ExponentPushToken[LIVE]');
  });
});

describe('admin console callables', () => {
  beforeEach(async () => {
    await seedProvider(STORE);
    await db.doc(`providers/${STORE}/members/${OWNER}`)
      .set({ phone: OWNER, role: 'owner', addedAt: new Date().toISOString() });
  });

  test('issues a code that redeemHqInvite then accepts', async () => {
    const res: any = await callable(fns.adminIssueStoreInvite,
      { phone: STAFF, providerId: STORE, name: 'Sam' }, adminAuth());

    expect(res.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    expect(res.providerId).toBe(STORE);

    // The whole point: what the console hands out actually works end to end.
    const joined: any = await callable(fns.redeemHqInvite, { code: res.code }, phoneAuth(STAFF));
    expect(joined.providerId).toBe(STORE);
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).toMatchObject({ role: 'staff', name: 'Sam' });
  });

  test('refuses every one of these to a non-admin', async () => {
    for (const [fn, data] of [
      [fns.adminIssueStoreInvite, { phone: STAFF, providerId: STORE }],
      [fns.adminListStoreInvites, {}],
      [fns.adminRevokeStoreInvite, { code: 'A7K2M9QP' }],
      [fns.adminRemoveStoreMember, { providerId: STORE, phone: OWNER }],
    ] as any[]) {
      // A signed-in provider is the realistic attacker here, not an anonymous one.
      await expect(callable(fn, data, phoneAuth(STAFF))).rejects.toThrow(/unauthorized/i);
      await expect(callable(fn, data, undefined)).rejects.toThrow(/unauthorized/i);
    }
  });

  test('will not invite someone who is already a member', async () => {
    await expect(callable(fns.adminIssueStoreInvite, { phone: OWNER, providerId: STORE }, adminAuth()))
      .rejects.toThrow(/already a member/i);
  });

  test('will not invite to a store that does not exist', async () => {
    await expect(callable(fns.adminIssueStoreInvite, { phone: STAFF, providerId: 'nope_00000' }, adminAuth()))
      .rejects.toThrow(/does not exist/i);
  });

  test('clamps the expiry instead of trusting the client', async () => {
    const res: any = await callable(fns.adminIssueStoreInvite,
      { phone: STAFF, providerId: STORE, ttlDays: 99999 }, adminAuth());
    const days = (Date.parse(res.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeLessThanOrEqual(366);
  });

  test('lists invites WITHOUT handing back the codes', async () => {
    const issued: any = await callable(fns.adminIssueStoreInvite,
      { phone: STAFF, providerId: STORE }, adminAuth());
    const res: any = await callable(fns.adminListStoreInvites, { providerId: STORE }, adminAuth());

    expect(res.invites).toHaveLength(1);
    expect(res.invites[0]).toMatchObject({ phone: STAFF, state: 'open', providerId: STORE });
    // A list endpoint that returned live credentials would undo the deny-all rule.
    expect(JSON.stringify(res.invites)).not.toContain(issued.code);
    expect(res.invites[0].codeHint).toBe(issued.code.slice(-3));
  });

  test('derives invite state rather than storing it', async () => {
    await seedInvite('A7K2M9QP', { phone: '+14025550001', expiresAt: inDays(-1) });
    await seedInvite('B7K2M9QP', { phone: '+14025550002', used: true });
    await seedInvite('C7K2M9QP', { phone: '+14025550003', revokedAt: new Date().toISOString() });
    const res: any = await callable(fns.adminListStoreInvites, { providerId: STORE }, adminAuth());
    const byPhone = Object.fromEntries(res.invites.map((i: any) => [i.phone, i.state]));
    expect(byPhone).toEqual({
      '+14025550001': 'expired', '+14025550002': 'used', '+14025550003': 'revoked',
    });
  });

  test('re-inviting withdraws the previous code so only one is ever live', async () => {
    const first: any = await callable(fns.adminIssueStoreInvite, { phone: STAFF, providerId: STORE }, adminAuth());
    const second: any = await callable(fns.adminIssueStoreInvite, { phone: STAFF, providerId: STORE }, adminAuth());

    expect(second.code).not.toBe(first.code);
    await expect(callable(fns.redeemHqInvite, { code: first.code }, phoneAuth(STAFF)))
      .rejects.toThrow(/already been used/i);
    const joined: any = await callable(fns.redeemHqInvite, { code: second.code }, phoneAuth(STAFF));
    expect(joined.providerId).toBe(STORE);
  });

  test('revokes by store+phone, which is all the console ever has', async () => {
    const issued: any = await callable(fns.adminIssueStoreInvite, { phone: STAFF, providerId: STORE }, adminAuth());
    await callable(fns.adminRevokeStoreInvite, { providerId: STORE, phone: STAFF }, adminAuth());
    await expect(callable(fns.redeemHqInvite, { code: issued.code }, phoneAuth(STAFF)))
      .rejects.toThrow(/already been used/i);
  });

  test('revoking kills an unredeemed code', async () => {
    const issued: any = await callable(fns.adminIssueStoreInvite,
      { phone: STAFF, providerId: STORE }, adminAuth());
    await callable(fns.adminRevokeStoreInvite, { code: issued.code }, adminAuth());
    await expect(callable(fns.redeemHqInvite, { code: issued.code }, phoneAuth(STAFF)))
      .rejects.toThrow(/already been used/i);
  });

  test('revoking a SPENT code says so, because it does not eject the member', async () => {
    const issued: any = await callable(fns.adminIssueStoreInvite,
      { phone: STAFF, providerId: STORE }, adminAuth());
    await callable(fns.redeemHqInvite, { code: issued.code }, phoneAuth(STAFF));
    const res: any = await callable(fns.adminRevokeStoreInvite, { code: issued.code }, adminAuth());

    expect(res.alreadyUsed).toBe(true);
    // Still a member — an admin must not be able to believe they revoked access.
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).not.toBeNull();
  });

  test('removes a member', async () => {
    await db.doc(`providers/${STORE}/members/${STAFF}`)
      .set({ phone: STAFF, role: 'staff', addedAt: new Date().toISOString() });
    await callable(fns.adminRemoveStoreMember, { providerId: STORE, phone: STAFF }, adminAuth());
    expect(await getDoc(`providers/${STORE}/members/${STAFF}`)).toBeNull();
  });

  test('refuses to remove the last owner', async () => {
    // A store with no owner is unrecoverable from inside the app: nobody can
    // delete it or invite anyone else.
    await expect(callable(fns.adminRemoveStoreMember, { providerId: STORE, phone: OWNER }, adminAuth()))
      .rejects.toThrow(/only owner/i);
  });

  test('allows removing an owner once a second one exists', async () => {
    await db.doc(`providers/${STORE}/members/${STAFF}`)
      .set({ phone: STAFF, role: 'owner', addedAt: new Date().toISOString() });
    await callable(fns.adminRemoveStoreMember, { providerId: STORE, phone: OWNER }, adminAuth());
    expect(await getDoc(`providers/${STORE}/members/${OWNER}`)).toBeNull();
  });
});
