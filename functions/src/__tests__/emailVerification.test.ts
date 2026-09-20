import {callable, fns, db, phoneAuth, seedUser, getDoc, clearFirestore} from './helpers';
import * as ev from '../emailVerification';

const PHONE = '+14025550000';

describe('accepted email domains', () => {
  test('the three providers, as customers actually hold them', () => {
    for (const ok of [
      'a@gmail.com', 'a@googlemail.com',
      'a@yahoo.com', 'a@yahoo.co.uk', 'a@yahoo.ca', 'a@ymail.com',
      'a@outlook.com', 'a@outlook.com.au', 'a@hotmail.com', 'a@hotmail.fr',
      'a@live.com', 'a@msn.com',
    ]) expect(ev.isAcceptedDomain(ok)).toBe(true);
  });

  test('everything else is turned away', () => {
    for (const no of [
      'a@icloud.com', 'a@me.com', 'a@proton.me', 'a@aol.com',
      'a@comcast.net', 'a@somecompany.com', 'a@gmail.co',
    ]) expect(ev.isAcceptedDomain(no)).toBe(false);
  });

  test('a lookalike domain is not the provider', () => {
    // The family rule is a prefix match, so the suffix has to stay TLD-shaped.
    for (const no of ['a@yahoo.attacker.com', 'a@outlook.phishing.net', 'a@notgmail.com', 'a@gmail.com.evil.io']) {
      expect(ev.isAcceptedDomain(no)).toBe(false);
    }
  });

  test('apiConfig can override the list outright', () => {
    expect(ev.isAcceptedDomain('a@foodyzz.com', ['foodyzz.com'])).toBe(true);
    expect(ev.isAcceptedDomain('a@gmail.com', ['foodyzz.com'])).toBe(false);
    expect(ev.isAcceptedDomain('a@gmail.com', [])).toBe(true); // empty = no override
  });

  test('addresses are normalised, junk is rejected', () => {
    expect(ev.normalizeEmail('  Ada@Gmail.COM ')).toBe('ada@gmail.com');
    for (const junk of ['', 'ada', 'ada@', '@gmail.com', 'ada@gmail', 'a b@gmail.com', null, 42]) {
      expect(ev.normalizeEmail(junk)).toBeNull();
    }
  });
});

describe('email confirmation', () => {
  let sent: jest.SpyInstance;
  const codeSent = () => sent.mock.calls[sent.mock.calls.length - 1][1];

  beforeEach(async () => {
    await clearFirestore();
    await seedUser(PHONE, {name: 'Ada Rider', onboarded: true});
    sent = jest.spyOn(ev.emailHooks, 'sendCode').mockResolvedValue(undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  const send = (email: string) => callable(fns.sendEmailVerificationCode, {email}, phoneAuth(PHONE));
  const confirm = (email: string, code: string) =>
    callable(fns.confirmEmailVerificationCode, {email, code}, phoneAuth(PHONE));

  test('a rejected domain never sends a code, and says which are accepted', async () => {
    await expect(send('ada@icloud.com')).rejects.toThrow(/Gmail, Yahoo or Outlook/);
    expect(sent).not.toHaveBeenCalled();
  });

  test('the code confirms the address and stamps the profile', async () => {
    await send('Ada@Gmail.com');
    expect(sent).toHaveBeenCalledWith('ada@gmail.com', expect.stringMatching(/^\d{6}$/), 10);

    await expect(confirm('ada@gmail.com', codeSent())).resolves.toEqual({verified: true});
    expect((await getDoc(`users/${PHONE}`)).emailVerified)
      .toMatchObject({email: 'ada@gmail.com', verifiedAt: expect.any(String)});
  });

  test('the code is never stored where it could be read back', async () => {
    await send('ada@gmail.com');
    const rec = await getDoc(`emailVerifications/${PHONE}`);
    expect(JSON.stringify(rec)).not.toContain(codeSent());
  });

  test('a wrong code counts down and then locks the code out', async () => {
    await send('ada@gmail.com');
    const wrong = codeSent() === '000000' ? '111111' : '000000';
    for (let i = 0; i < ev.MAX_ATTEMPTS_PER_CODE; i++) {
      await expect(confirm('ada@gmail.com', wrong)).rejects.toThrow(/not right/);
    }
    await expect(confirm('ada@gmail.com', wrong)).rejects.toThrow(/Too many wrong codes/);
    // Even the real code is spent once the attempts are gone.
    await expect(confirm('ada@gmail.com', codeSent())).rejects.toThrow(/Too many wrong codes/);
  });

  test('a code for one address does not confirm another', async () => {
    await send('ada@gmail.com');
    await expect(confirm('someone@yahoo.com', codeSent())).rejects.toThrow(/Ask for a new code/);
    expect((await getDoc(`users/${PHONE}`)).emailVerified).toBeUndefined();
  });

  test('an expired code is refused', async () => {
    await send('ada@gmail.com');
    await db.doc(`emailVerifications/${PHONE}`)
      .update({expiresAt: new Date(Date.now() - 1000).toISOString()});
    await expect(confirm('ada@gmail.com', codeSent())).rejects.toThrow(/expired/);
  });

  test('resends are throttled, and the daily budget is finite', async () => {
    await send('ada@gmail.com');
    await expect(send('ada@gmail.com')).rejects.toThrow(/Please wait \d+s/);

    for (let i = 1; i < ev.MAX_SENDS_PER_DAY; i++) {
      await db.doc(`emailVerifications/${PHONE}`).update({sentAt: new Date(0).toISOString()});
      await send('ada@gmail.com');
    }
    await db.doc(`emailVerifications/${PHONE}`).update({sentAt: new Date(0).toISOString()});
    await expect(send('ada@gmail.com')).rejects.toThrow(/Too many codes requested today/);
  });

  test('an address already confirmed needs no second code', async () => {
    await send('ada@gmail.com');
    await confirm('ada@gmail.com', codeSent());
    sent.mockClear();
    await expect(send('ada@gmail.com')).resolves.toEqual({alreadyVerified: true, resendInSec: 0});
    expect(sent).not.toHaveBeenCalled();
  });

  test('changing to a new address needs a fresh code and restamps the profile', async () => {
    await send('ada@gmail.com');
    await confirm('ada@gmail.com', codeSent());

    await db.doc(`emailVerifications/${PHONE}`).update({sentAt: new Date(0).toISOString()});
    await send('ada@yahoo.co.uk');
    // Until the new one lands, the profile still shows the old confirmed address.
    expect((await getDoc(`users/${PHONE}`)).emailVerified.email).toBe('ada@gmail.com');
    await confirm('ada@yahoo.co.uk', codeSent());
    expect((await getDoc(`users/${PHONE}`)).emailVerified.email).toBe('ada@yahoo.co.uk');
  });

  test('signed out, nobody can start or confirm anything', async () => {
    await expect(callable(fns.sendEmailVerificationCode, {email: 'ada@gmail.com'}))
      .rejects.toThrow(/Authentication required/);
    await expect(callable(fns.confirmEmailVerificationCode, {email: 'ada@gmail.com', code: '123456'}))
      .rejects.toThrow(/Authentication required/);
  });

  test('a customer part-way through onboarding can still confirm', async () => {
    // The profile doc may not exist yet at the email step; the stamp must not fail.
    await db.doc(`users/${PHONE}`).delete();
    await send('ada@gmail.com');
    await expect(confirm('ada@gmail.com', codeSent())).resolves.toEqual({verified: true});
    expect((await getDoc(`users/${PHONE}`)).emailVerified.email).toBe('ada@gmail.com');
  });
});
