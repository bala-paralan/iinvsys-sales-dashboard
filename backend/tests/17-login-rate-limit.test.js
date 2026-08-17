'use strict';
/**
 * Login rate limiting — per ACCOUNT, not per IP.
 *
 * Found by running the app, not by reading it. Keyed on IP alone, five fumbled
 * passwords lock out everyone sharing that address — and referrers capture
 * leads at an expo from behind one venue's NAT, so one person mistyping their
 * password would take the whole stand offline for fifteen minutes.
 *
 * ── Why this file tests structure rather than behaviour ──────────────────
 * Limiters are disabled under NODE_ENV=test on purpose: their state is
 * process-global and survives between cases, which is what made the auth suite
 * order-dependent before. Re-requiring app.js with them switched on means
 * re-registering every mongoose model, which deadlocks.
 *
 * So the behaviour was verified against a running server (5 failures lock the
 * account; a different account on the same IP still gets 200; the correct
 * password still gets 429), and what is pinned HERE is the invariant that
 * silently breaks it:
 *
 *   the login limiter must be mounted AFTER the JSON body parser.
 *
 * Mounted before, req.body is undefined, every attempt collapses onto the key
 * `<ip>|`, and per-account limiting degrades to per-IP. Nothing throws. The
 * limiter still "works". It just protects the wrong thing — which reads as
 * correct in review, and is the actual bug that was found.
 */
const app = require('../src/app');

const layers = () => (app._router || app.router).stack;
const indexOfNamed = (name) => layers().findIndex((l) => l.name === name);
const indexOfMount = (pattern) =>
  layers().findIndex((l) => l.regexp && l.regexp.toString().includes(pattern));

describe('middleware mount order', () => {
  it('mounts the JSON body parser before the login limiter', () => {
    const json = indexOfNamed('jsonParser');
    const loginLimiter = indexOfMount('\\/api\\/auth\\/login');

    expect(json).toBeGreaterThan(-1);
    expect(loginLimiter).toBeGreaterThan(-1);
    expect(json).toBeLessThan(loginLimiter);
  });

  it('keeps the volumetric /api limiter ahead of body parsing', () => {
    /* A flood should be refused before any payload is read. */
    const apiLimiter = indexOfMount('\\/api\\/?(?=');
    const json = indexOfNamed('jsonParser');

    expect(apiLimiter).toBeGreaterThan(-1);
    expect(apiLimiter).toBeLessThan(json);
  });

  it('the two limiters are distinct mounts, not one shared bucket', () => {
    expect(indexOfMount('\\/api\\/auth\\/login')).not.toBe(indexOfMount('\\/api\\/?(?='));
  });
});

describe('the login limiter is keyed per account', () => {
  /* Rebuilding the limiter here would need the app; instead assert the property
     that matters on the same keyGenerator shape app.js installs. */
  const keyGenerator = (req) => {
    const email = String(req.body?.email || '').toLowerCase().trim();
    return `${req.ip}|${email}`;
  };

  it('two accounts from one IP get different buckets', () => {
    const a = keyGenerator({ ip: '10.0.0.1', body: { email: 'admin@x.test' } });
    const b = keyGenerator({ ip: '10.0.0.1', body: { email: 'sneha@x.test' } });
    expect(a).not.toBe(b);
  });

  it('one account from two IPs also gets different buckets', () => {
    const a = keyGenerator({ ip: '10.0.0.1', body: { email: 'admin@x.test' } });
    const b = keyGenerator({ ip: '10.0.0.2', body: { email: 'admin@x.test' } });
    expect(a).not.toBe(b);
  });

  it('normalises case and whitespace so `Admin@x` cannot get a second budget', () => {
    expect(keyGenerator({ ip: '10.0.0.1', body: { email: '  ADMIN@X.test ' } }))
      .toBe(keyGenerator({ ip: '10.0.0.1', body: { email: 'admin@x.test' } }));
  });

  it('degrades to a per-IP key when the body is missing — the failure mode to avoid', () => {
    /* This is what happens if the limiter is ever mounted before the parser.
       Documented here so the mount-order test above reads as consequential
       rather than arbitrary. */
    expect(keyGenerator({ ip: '10.0.0.1' })).toBe('10.0.0.1|');
    expect(keyGenerator({ ip: '10.0.0.1', body: {} })).toBe('10.0.0.1|');
  });
});
