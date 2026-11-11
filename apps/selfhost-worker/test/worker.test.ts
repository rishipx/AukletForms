import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { handleRequest, type Env } from '../src/index';

const BASE = 'https://forms.example.workers.dev';

const baseEnv = (over: Partial<Env> = {}): Env => ({
  RESEND_API_KEY: 're_test_key',
  TO_EMAIL: 'owner@example.com',
  FROM_EMAIL: 'Website <forms@example.com>',
  ALLOWED_ORIGINS: '',
  ...over,
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

let calls: Call[];
/** One entry per Resend attempt: an HTTP status, or 'network' to throw. The last entry repeats. */
let resendScript: Array<number | 'network'>;

beforeEach(() => {
  calls = [];
  resendScript = [200];
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({
        url,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
      });
      const step = resendScript[Math.min(calls.length - 1, resendScript.length - 1)];
      if (step === 'network') throw new TypeError('network down');
      return step === 200 ? Response.json({ id: 'email_1' }) : new Response(JSON.stringify({ message: 'nope' }), { status: step });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jsonPost = (body: unknown, headers: Record<string, string> = {}, path = '/') =>
  new Request(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });

const send = (request: Request, env: Env = baseEnv()) => handleRequest(request, env);

describe('successful delivery', () => {
  it('emails the owner through Resend and returns {success, id}', async () => {
    const res = await send(jsonPost({ name: 'Ada', email: 'ada@example.com', message: 'Hello there' }, { origin: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as { success: boolean; id: string };
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe('https://api.resend.com/emails');
    expect(call.headers['authorization']).toBe('Bearer re_test_key');
    expect(call.headers['user-agent']).toMatch(/^auklet-forms-selfhost\//);
    expect(call.headers['idempotency-key']).toBe(`auklet-${body.id}`);
    expect(call.body).toMatchObject({
      from: 'Website <forms@example.com>',
      to: ['owner@example.com'],
      subject: 'New form submission',
      reply_to: 'ada@example.com',
    });
    expect(String(call.body['html'])).toContain('Hello there');
    expect(String(call.body['text'])).toContain('message: Hello there');
    expect(String(call.body['text'])).toContain(`Submission ID ${body.id}`);
  });

  it('supports several recipients, a custom subject, and the default sandbox sender', async () => {
    await send(jsonPost({ a: 1 }), baseEnv({ TO_EMAIL: 'a@example.com, b@example.com', SUBJECT: 'Site\r\nBcc: x@y.z', FROM_EMAIL: undefined }));
    expect(calls[0]?.body).toMatchObject({ to: ['a@example.com', 'b@example.com'], subject: 'Site Bcc: x@y.z', from: 'Auklet Forms <onboarding@resend.dev>' });
  });

  it('escapes submitter HTML and refuses a Reply-To that could inject headers', async () => {
    await send(jsonPost({ message: '<img src=x onerror=alert(1)>', email: 'ada@example.com\r\nBcc: evil@example.com' }));
    const html = String(calls[0]?.body['html']);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(calls[0]?.body).not.toHaveProperty('reply_to');
  });

  it('accepts url-encoded and multipart bodies and groups repeated keys', async () => {
    await send(new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Ada&topic=a&topic=b' }));
    expect(String(calls[0]?.body['text'])).toContain('topic: a, b');

    const fd = new FormData();
    fd.append('name', 'Bob');
    fd.append('cv', new File(['hello'], 'cv.txt', { type: 'text/plain' }));
    await send(new Request(`${BASE}/`, { method: 'POST', body: fd }));
    const text = String(calls[1]?.body['text']);
    expect(text).toContain('name: Bob');
    expect(text).toContain('"filename":"cv.txt"');
    expect(text).toContain('"attached":false');
  });

  it('accepts the hosted edition path so snippets keep working after swapping the host', async () => {
    const res = await send(jsonPost({ a: 1 }, {}, '/v1/f/11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
  });

  it('works through the default export too', async () => {
    const res = await worker.fetch(jsonPost({ a: 1 }), baseEnv());
    expect(res.status).toBe(200);
  });
});

describe('response modes', () => {
  const nativePost = (headers: Record<string, string> = {}) =>
    new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: 'name=Ada' });

  it('redirects plain HTML form posts to the built-in thank-you page', async () => {
    const res = await send(nativePost({ 'sec-fetch-mode': 'navigate', accept: 'text/html' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`${BASE}/thanks`);
  });

  it('redirects to REDIRECT_URL when configured', async () => {
    const res = await send(nativePost(), baseEnv({ REDIRECT_URL: 'https://example.com/thanks' }));
    expect(res.headers.get('location')).toBe('https://example.com/thanks');
  });

  it('returns JSON for fetch() clients even without an Accept header', async () => {
    const res = await send(nativePost({ 'sec-fetch-mode': 'cors' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);
  });

  it('serves the thank-you page and a health check', async () => {
    const thanks = await send(new Request(`${BASE}/thanks`));
    expect(thanks.status).toBe(200);
    expect(await thanks.text()).toContain('Thank you');
    expect(await (await send(new Request(`${BASE}/healthz`))).json()).toEqual({ ok: true });
  });
});

describe('spam trap', () => {
  it.each(['_gotcha', '_botcheck', '_honeypot'])('silently succeeds without sending email when %s is filled', async (field) => {
    const res = await send(jsonPost({ name: 'Bot', [field]: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('redirects bots too on native posts, so they cannot tell they were caught', async () => {
    const res = await send(
      new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Bot&_gotcha=x' }),
    );
    expect(res.status).toBe(302);
    expect(calls).toHaveLength(0);
  });

  it('lets people through when the honeypot is empty and keeps it out of the email', async () => {
    await send(jsonPost({ name: 'Ada', _gotcha: '' }));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]?.body['text'])).not.toContain('_gotcha');
  });
});

describe('CORS', () => {
  const env = baseEnv({ ALLOWED_ORIGINS: 'example.com, *.example.com, localhost:3000' });

  it.each(['https://example.com', 'https://app.example.com', 'http://localhost:3000'])('echoes allowed origin %s', async (origin) => {
    const res = await send(jsonPost({ a: 1 }, { origin }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(origin);
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it.each(['https://evil.io', 'https://example.com.evil.io', 'http://localhost:4000', 'null'])('rejects %s with 403 and sends no email', async (origin) => {
    const res = await send(jsonPost({ a: 1 }, { origin }), env);
    expect(res.status).toBe(403);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('answers preflights with 204 and rejects disallowed ones', async () => {
    const ok = await send(
      new Request(`${BASE}/`, { method: 'OPTIONS', headers: { origin: 'https://example.com', 'access-control-request-headers': 'content-type' } }),
      env,
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(ok.headers.get('access-control-allow-headers')).toBe('content-type');
    const bad = await send(new Request(`${BASE}/`, { method: 'OPTIONS', headers: { origin: 'https://evil.io' } }), env);
    expect(bad.status).toBe(403);
  });

  it('falls back to Referer, and allows requests with neither header (curl)', async () => {
    expect((await send(jsonPost({ a: 1 }, { referer: 'https://example.com/contact' }), env)).status).toBe(200);
    expect((await send(jsonPost({ a: 1 }, { referer: 'https://evil.io/page' }), env)).status).toBe(403);
    expect((await send(jsonPost({ a: 1 }), env)).status).toBe(200);
  });

  it('treats "*" as allow-any and attaches CORS headers to errors so browsers can read them', async () => {
    const wild = baseEnv({ ALLOWED_ORIGINS: '*' });
    const res = await send(jsonPost({}, { origin: 'https://anything.io' }), wild);
    expect(res.status).toBe(400);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});

describe('Resend failures', () => {
  it('retries once on a 5xx and succeeds, reusing the same idempotency key', async () => {
    resendScript = [500, 200];
    const res = await send(jsonPost({ a: 1 }));
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.headers['idempotency-key']).toBe(calls[1]?.headers['idempotency-key']);
  });

  it('retries once after a network error', async () => {
    resendScript = ['network', 200];
    expect((await send(jsonPost({ a: 1 }))).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('answers 502 problem+json when delivery keeps failing, so the form can show an error', async () => {
    resendScript = [500];
    const res = await send(jsonPost({ a: 1 }, { origin: 'https://example.com' }));
    expect(res.status).toBe(502);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['type']).toBe('https://auklet.dev/problems/delivery-failed');
    expect(calls).toHaveLength(2);
  });

  it('does not retry client errors such as a bad API key, and leaks nothing about it', async () => {
    resendScript = [401];
    const res = await send(jsonPost({ a: 1 }));
    expect(res.status).toBe(502);
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(await res.json())).not.toMatch(/re_test_key|401|resend/i);
  });

  it('retries a 429 from Resend', async () => {
    resendScript = [429, 200];
    expect((await send(jsonPost({ a: 1 }))).status).toBe(200);
  });
});

describe('rate limiting binding', () => {
  it('returns 429 and sends nothing when the limiter says no, keyed by client IP', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await send(jsonPost({ a: 1 }, { 'cf-connecting-ip': '203.0.113.7' }), baseEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(calls).toHaveLength(0);
  });

  it('allows requests through when the limiter says yes', async () => {
    const limit = vi.fn(async () => ({ success: true }));
    expect((await send(jsonPost({ a: 1 }), baseEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }))).status).toBe(200);
  });

  it('keeps accepting real submissions if the limiter itself errors', async () => {
    const limit = vi.fn(async () => {
      throw new Error('limiter down');
    });
    expect((await send(jsonPost({ a: 1 }), baseEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }))).status).toBe(200);
  });

  it('does not count preflight requests', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    const res = await send(new Request(`${BASE}/`, { method: 'OPTIONS' }), baseEnv({ RATE_LIMITER: { limit } as unknown as RateLimit }));
    expect(res.status).toBe(204);
    expect(limit).not.toHaveBeenCalled();
  });
});

describe('request validation', () => {
  it('rejects unsupported content types, malformed bodies, non-objects and empty submissions', async () => {
    expect((await send(new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hi' }))).status).toBe(415);
    expect((await send(new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' }))).status).toBe(400);
    expect((await send(new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[1,2]' }))).status).toBe(400);
    expect((await send(jsonPost({}))).status).toBe(400);
    expect((await send(jsonPost({ _gotcha: '' }))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('rejects oversized bodies and too many fields', async () => {
    const big = await send(
      new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `a=${'x'.repeat(1_100_000)}` }),
    );
    expect(big.status).toBe(413);
    const fields = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, 'x']));
    expect((await send(jsonPost(fields))).status).toBe(400);
  });

  it('keeps a __proto__ field as ordinary data', async () => {
    await send(new Request(`${BASE}/`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '__proto__=x&a=1' }));
    expect(String(calls[0]?.body['text'])).toContain('__proto__: x');
  });

  it('answers 404 for unknown paths and 405 for other methods', async () => {
    expect((await send(new Request(`${BASE}/nope`, { method: 'POST' }))).status).toBe(404);
    expect((await send(new Request(`${BASE}/v1/other`, { method: 'POST' }))).status).toBe(404);
    const get = await send(new Request(`${BASE}/`));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
  });
});

describe('configuration errors', () => {
  it.each([
    ['missing API key', { RESEND_API_KEY: '' }],
    ['missing recipient', { TO_EMAIL: '' }],
    ['invalid recipient', { TO_EMAIL: 'not-an-email' }],
    ['one bad address in a list', { TO_EMAIL: 'ok@example.com, nope' }],
    ['too many recipients', { TO_EMAIL: Array.from({ length: 11 }, (_, i) => `u${i}@example.com`).join(',') }],
    ['bad redirect URL', { REDIRECT_URL: 'javascript:alert(1)' }],
  ])('returns 500 without leaking details: %s', async (_name, over) => {
    const res = await send(jsonPost({ a: 1 }), baseEnv(over));
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['type']).toBe('https://auklet.dev/problems/server-misconfigured');
    expect(JSON.stringify(body)).not.toMatch(/RESEND|TO_EMAIL|REDIRECT/);
    expect(calls).toHaveLength(0);
  });
});
