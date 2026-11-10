import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  baseForm,
  callsTo,
  ENDPOINT,
  FORM_ID,
  insertedRow,
  inserts,
  installHarness,
  jsonPost,
  kv,
  makeEnv,
  send,
  statusPatches,
  SUPABASE,
  upstream,
} from './helpers';

installHarness();

describe('notification email budget', () => {
  it('records "sent" once the email goes out', async () => {
    await send(jsonPost({ name: 'Ada' }));
    expect(insertedRow()['notify_status']).toBe('pending');
    expect(statusPatches()).toEqual([{ notify_status: 'sent' }]);
    const reservation = JSON.parse(callsTo('consume_email_slot')[0]?.body ?? '{}') as Record<string, unknown>;
    expect(reservation).toEqual({ p_form_id: FORM_ID, p_form_cap: 25, p_global_cap: 90 });
  });

  it('passes configured caps through', async () => {
    const env = { ...makeEnv(), EMAIL_DAILY_FORM_CAP: '3', EMAIL_DAILY_GLOBAL_CAP: '40' };
    await send(jsonPost({ name: 'Ada' }), env);
    expect(JSON.parse(callsTo('consume_email_slot')[0]?.body ?? '{}')).toMatchObject({ p_form_cap: 3, p_global_cap: 40 });
  });

  it.each(['form_cap', 'global_cap'] as const)('%s: still stores the submission and relays to Slack, but sends no email', async (verdict) => {
    upstream.emailBudget = verdict;
    const res = await send(jsonPost({ name: 'Ada' }));
    expect(res.status).toBe(200);
    expect(callsTo('api.resend.com')).toHaveLength(0);
    expect(insertedRow()['notify_status']).toBe('skipped_cap');
    expect(callsTo('hooks.slack.com')).toHaveLength(1);
    expect(statusPatches()).toEqual([]);
  });

  it('fails open when the budget check errors: the email is still sent', async () => {
    upstream.emailBudget = 'error';
    await send(jsonPost({ name: 'Ada' }));
    expect(callsTo('api.resend.com')).toHaveLength(1);
    expect(statusPatches()).toEqual([{ notify_status: 'sent' }]);
  });

  it('records "failed" when Resend rejects the email', async () => {
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://api.resend.com/')) return new Response('nope', { status: 422 });
      return original(input, init);
    });
    await send(jsonPost({ name: 'Ada' }));
    expect(statusPatches()).toEqual([{ notify_status: 'failed' }]);
  });

  it('does not try to update the status of a row whose insert failed', async () => {
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      // Only the INSERT fails; a PATCH would reach the recording stub, so a wrongly attempted update is visible.
      if (url.startsWith(`${SUPABASE}/rest/v1/submissions`) && init?.method === 'POST') return new Response('boom', { status: 500 });
      return original(input, init);
    });
    await send(jsonPost({ name: 'Ada' }));
    expect(statusPatches()).toEqual([]);
  });
});

describe('spam heuristic', () => {
  const links = (n: number) => Array.from({ length: n }, (_, i) => `https://spam${i}.example/x`).join(' ');

  it('stores link-stuffed submissions as spam without emailing, relaying or spending email budget', async () => {
    const res = await send(jsonPost({ name: 'Bot', message: links(4) }));
    expect(res.status).toBe(200);
    const row = insertedRow();
    expect(row['is_spam']).toBe(true);
    expect(row['notify_status']).toBe('skipped_spam');
    expect(callsTo('api.resend.com')).toHaveLength(0);
    expect(callsTo('hooks.slack.com')).toHaveLength(0);
    expect(callsTo('consume_email_slot')).toHaveLength(0);
  });

  it('leaves ordinary messages alone, including ones with a few links', async () => {
    await send(jsonPost({ name: 'Ada', message: `see ${links(3)}` }));
    expect(insertedRow()['is_spam']).toBe(false);
    expect(callsTo('api.resend.com')).toHaveLength(1);
  });

  it('counts links in nested values too', async () => {
    await send(jsonPost({ name: 'Bot', extra: { a: links(2), b: [links(2)] } }));
    expect(insertedRow()['is_spam']).toBe(true);
  });
});

describe('rate limiting', () => {
  const limiter = (success: boolean) => {
    const keys: string[] = [];
    return { keys, binding: { limit: async ({ key }: { key: string }) => (keys.push(key), { success }) } as unknown as RateLimit };
  };

  it('answers 429 before any cache or database access when the limiter says no', async () => {
    const rl = limiter(false);
    const res = await send(jsonPost({ name: 'Ada' }, { 'cf-connecting-ip': '198.51.100.9' }), { ...makeEnv(), RATE_LIMITER: rl.binding });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(((await res.json()) as { type: string }).type).toBe('https://auklet.dev/problems/rate-limited');
    expect(upstream.calls).toHaveLength(0);
    expect(rl.keys).toEqual([`198.51.100.9:${FORM_ID}`]);
  });

  it('lets requests through when under the limit', async () => {
    const rl = limiter(true);
    expect((await send(jsonPost({ name: 'Ada' }), { ...makeEnv(), RATE_LIMITER: rl.binding })).status).toBe(200);
  });

  it('fails open if the limiter itself errors', async () => {
    const broken = {
      limit: async () => {
        throw new Error('limiter down');
      },
    } as unknown as RateLimit;
    expect((await send(jsonPost({ name: 'Ada' }), { ...makeEnv(), RATE_LIMITER: broken })).status).toBe(200);
  });

  it('does not count preflight requests', async () => {
    const rl = limiter(false);
    const res = await send(new Request(ENDPOINT, { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-method': 'POST' } }), {
      ...makeEnv(),
      RATE_LIMITER: rl.binding,
    });
    expect(res.status).toBe(204);
    expect(rl.keys).toEqual([]);
  });
});

describe('submission size', () => {
  it('rejects more than 64 KiB of fields with 413 and consumes no quota', async () => {
    const res = await send(jsonPost({ message: 'x'.repeat(70_000) }));
    expect(res.status).toBe(413);
    expect(((await res.json()) as { type: string }).type).toBe('https://auklet.dev/problems/submission-too-large');
    expect(callsTo('consume_submission_quota')).toHaveLength(0);
    expect(inserts()).toHaveLength(0);
  });

  it('accepts a large but allowed message', async () => {
    expect((await send(jsonPost({ message: 'x'.repeat(60_000) }))).status).toBe(200);
  });
});

describe('encrypted Turnstile secrets', () => {
  const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
  const ENCRYPTED = 'enc:v1:oKGio6Slpqeoqaqr1mBIbASKQ/4jJKqncgiurQTFNXW/xCcP7mtSlFdfeKO3KzHp8cvTlF24Rg==';
  const verifyBody = () => callsTo('challenges.cloudflare.com')[0]?.body ?? '';

  beforeEach(() => {
    upstream.form = { ...baseForm, enable_turnstile: true, turnstile_secret_key: ENCRYPTED };
  });

  it('decrypts the stored key just before calling Cloudflare', async () => {
    const res = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'tok' }), { ...makeEnv(), TURNSTILE_ENC_KEY: KEY });
    expect(res.status).toBe(200);
    expect(new URLSearchParams(verifyBody()).get('secret')).toBe('0x4AAAAAAA-turnstile-secret');
  });

  it('keeps ciphertext, not the secret, in the KV cache', async () => {
    await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'tok' }), { ...makeEnv(), TURNSTILE_ENC_KEY: KEY });
    const cached = kv.get(`form:${FORM_ID}`) ?? '';
    expect(cached).toContain('enc:v1:');
    expect(cached).not.toContain('0x4AAAAAAA');
  });

  it('fails closed with 503 and never calls Cloudflare if the key is missing or wrong', async () => {
    const missing = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'tok' }));
    expect(missing.status).toBe(503);
    const wrong = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'tok' }), {
      ...makeEnv(),
      TURNSTILE_ENC_KEY: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA=',
    });
    expect(wrong.status).toBe(503);
    expect(callsTo('challenges.cloudflare.com')).toHaveLength(0);
  });
});

describe('in-memory form cache', () => {
  afterEach(() => vi.useRealTimers());

  it('serves repeat requests without touching KV or the database', async () => {
    await send(jsonPost({ name: 'one' }));
    kv.clear(); // a KV outage or eviction must not matter while the isolate is warm
    await send(jsonPost({ name: 'two' }));
    expect(callsTo('/rest/v1/forms')).toHaveLength(1);
  });

  it('expires after 30 seconds so dashboard edits still propagate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    await send(jsonPost({ name: 'one' }));
    kv.clear();
    vi.setSystemTime(Date.now() + 31_000);
    await send(jsonPost({ name: 'two' }));
    expect(callsTo('/rest/v1/forms')).toHaveLength(2);
  });
});
