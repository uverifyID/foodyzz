/**
 * contactForm (marketing-site contact endpoint) — validation & abuse-guard tests.
 *
 * The full happy path sends real SMTP mail, so it isn't exercised here; these
 * tests cover everything BEFORE the email: method guard, honeypot, input
 * validation, and the per-IP hourly rate limit (which writes Firestore docs).
 */
import { fns, clearFirestore, getDoc, db } from './helpers';

// Minimal Express-style req/res mocks for a v2 onRequest handler.
function mockReq(overrides: any = {}) {
  return {
    method: 'POST',
    headers: { origin: 'https://foodyzz.com', 'x-forwarded-for': '203.0.113.7' },
    ip: '203.0.113.7',
    body: {},
    ...overrides,
  } as any;
}
function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    set(k: string, v: string) { this.headers[k] = v; return this; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; return this; },
    send(b: any) { this.body = b; return this; },
    // Event-emitter surface the firebase-functions v2 wrapper touches.
    on() { return this; },
    once() { return this; },
    end(b?: any) { if (b !== undefined) this.body = b; return this; },
    getHeader(k: string) { return this.headers[k]; },
    setHeader(k: string, v: string) { this.headers[k] = v; return this; },
  };
  return res;
}

const run = (req: any) => {
  const res = mockRes();
  // A v2 onRequest export is directly callable as (req, res).
  return Promise.resolve((fns.contactForm as any)(req, res)).then(() => res);
};

beforeEach(async () => { await clearFirestore(); });

describe('contactForm guards', () => {
  test('rejects non-POST', async () => {
    const res = await run(mockReq({ method: 'GET' }));
    expect(res.statusCode).toBe(405);
  });

  test('OPTIONS preflight returns 204 with CORS for an allowed origin', async () => {
    const res = await run(mockReq({ method: 'OPTIONS' }));
    expect(res.statusCode).toBe(204);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('https://foodyzz.com');
  });

  test('does NOT reflect CORS for an unknown origin', async () => {
    const res = await run(mockReq({ method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
    expect(res.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  test('honeypot filled → fake success, nothing stored', async () => {
    const res = await run(mockReq({ body: { name: 'Bot', email: 'b@b.co', message: 'spam', website: 'http://spam' } }));
    expect(res.body).toEqual({ ok: true });
    const msgs = await db.collection('contactMessages').get();
    expect(msgs.size).toBe(0);
  });

  test('missing/invalid fields → 400', async () => {
    const res = await run(mockReq({ body: { name: 'A', email: 'not-an-email', message: '' } }));
    expect(res.statusCode).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  test('rate limit: 6th message in the hour from one IP → 429', async () => {
    // Pre-seed the counter at the cap for this ip+hour.
    const hourKey = new Date().toISOString().slice(0, 13);
    await db.collection('contactRateLimits').doc(`203.0.113.7_${hourKey}`).set({ count: 5 });

    const res = await run(mockReq({ body: { name: 'A', email: 'a@a.co', message: 'hello there' } }));
    expect(res.statusCode).toBe(429);
  });

  test('valid message under limit passes validation and records the audit doc (email step then fails without SMTP → 500)', async () => {
    const res = await run(mockReq({ body: { name: 'Rider', email: 'r@r.co', topic: 'plans', message: 'What plans do you offer?' } }));
    // No apiConfigSecret/smtp in the emulator → sendEmail throws AFTER the audit
    // write, so we expect the 500 branch but WITH the message stored. This pins
    // the ordering (store first, then email) and the validation pass-through.
    expect(res.statusCode).toBe(500);
    const msgs = await db.collection('contactMessages').get();
    expect(msgs.size).toBe(1);
    expect(msgs.docs[0].data().email).toBe('r@r.co');
    // Rate-limit counter incremented for this ip+hour
    const hourKey = new Date().toISOString().slice(0, 13);
    const rl = await getDoc(`contactRateLimits/203.0.113.7_${hourKey}`);
    expect(rl.count).toBe(1);
  });
});
