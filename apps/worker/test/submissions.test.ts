import { describe, expect, it, vi } from 'vitest';
import { baseForm, callsTo, ENDPOINT, FORM_ID, inserts, installHarness, jsonPost, kv, makeEnv, send, SUPABASE, upstream, USER_ID } from './helpers';

installHarness();

describe('successful submissions', () => {
  it('returns {success,id} immediately and does the work in the background', async () => {
    const res = await send(
      jsonPost({ name: 'Ada', email: 'ada@example.com', message: 'Hello' }, { 'cf-connecting-ip': '203.0.113.7', 'user-agent': 'vitest' }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    const body = (await res.json()) as { success: boolean; id: string };
    expect(body.success).toBe(true);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);

    // Stored with the SAME id that was returned to the client.
    const insert = callsTo('/rest/v1/submissions')[0];
    expect(insert).toBeDefined();
    const row = JSON.parse(insert?.body ?? '{}') as Record<string, unknown>;
    expect(row['id']).toBe(body.id);
    expect(row['form_id']).toBe(FORM_ID);
    expect(row['payload']).toEqual({ name: 'Ada', email: 'ada@example.com', message: 'Hello' });
    expect(row['submitter_ip']).toBe('203.0.113.7');
    expect(row['user_agent']).toBe('vitest');

    const quota = callsTo('consume_submission_quota')[0];
    expect(JSON.parse(quota?.body ?? '{}')).toEqual({ p_user_id: USER_ID });

    const email = JSON.parse(callsTo('api.resend.com')[0]?.body ?? '{}') as Record<string, unknown>;
    expect(email['to']).toEqual(['owner@example.com']);
    expect(email['reply_to']).toBe('ada@example.com');
    expect(email['from']).toBe('Auklet <forms@notify.auklet.dev>');
    expect(callsTo('hooks.slack.com')).toHaveLength(1);
  });

  it('sends a User-Agent on every outbound notification (Resend 403s without one)', async () => {
    await send(jsonPost({ name: 'Ada' }));
    for (const fragment of ['api.resend.com', 'hooks.slack.com']) {
      const call = callsTo(fragment)[0];
      expect(call, fragment).toBeDefined();
      expect(call?.headers['user-agent'], fragment).toMatch(/^auklet-worker\//);
    }
  });

  it('answers native form posts with a 302 to the form redirect_url', async () => {
    const res = await send(
      new Request(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://example.com', 'sec-fetch-mode': 'navigate', accept: 'text/html' },
        body: 'name=Ada&message=Hi',
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/thanks');
    expect(inserts()).toHaveLength(1);
  });

  it('falls back to the hosted thank-you page when no redirect_url is set', async () => {
    upstream.form = { ...baseForm, redirect_url: null };
    const res = await send(new Request(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Ada' }));
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://api.test/thanks');
  });

  it('still emails the owner if the database insert fails', async () => {
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith(`${SUPABASE}/rest/v1/submissions`)) return new Response('boom', { status: 500 });
      return original(input, init);
    });
    const res = await send(jsonPost({ name: 'Ada' }));
    expect(res.status).toBe(200);
    expect(callsTo('api.resend.com')).toHaveLength(1);
  });

  it('serves the thank-you page and a health check', async () => {
    const thanks = await send(new Request('https://api.test/thanks'));
    expect(thanks.status).toBe(200);
    expect(await thanks.text()).toContain('Thank you');
    const health = await send(new Request('https://api.test/healthz'));
    expect(await health.json()).toEqual({ ok: true });
  });
});

describe('spam filtering', () => {
  it('silently succeeds on a tripped honeypot without storing, emailing or using quota', async () => {
    const res = await send(jsonPost({ name: 'Bot', _gotcha: 'http://spam.example' }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { success: boolean }).success).toBe(true);
    expect(callsTo('/rest/v1/submissions')).toHaveLength(0);
    expect(callsTo('consume_submission_quota')).toHaveLength(0);
    expect(callsTo('api.resend.com')).toHaveLength(0);
  });

  it('redirects bots too on native posts, so they cannot tell they were caught', async () => {
    const res = await send(
      new Request(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'name=Bot&_honeypot=x' }),
    );
    expect(res.status).toBe(302);
    expect(callsTo('/rest/v1/submissions')).toHaveLength(0);
  });

  it('requires and verifies Turnstile when enabled, and strips the token from the stored payload', async () => {
    upstream.form = { ...baseForm, enable_turnstile: true, turnstile_secret_key: 'secret-123' };

    const missing = await send(jsonPost({ name: 'Ada' }));
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { type: string }).type).toBe('https://auklet.dev/problems/turnstile-required');

    upstream.turnstileSuccess = false;
    const rejected = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'bad' }));
    expect(rejected.status).toBe(403);
    expect(callsTo('consume_submission_quota')).toHaveLength(0);

    upstream.turnstileSuccess = true;
    upstream.calls.length = 0;
    const ok = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'good' }, { 'cf-connecting-ip': '203.0.113.9' }));
    expect(ok.status).toBe(200);
    const verify = callsTo('challenges.cloudflare.com')[0];
    expect(verify?.body).toContain('secret=secret-123');
    expect(verify?.body).toContain('response=good');
    expect(verify?.body).toContain('remoteip=203.0.113.9');
    const row = JSON.parse(callsTo('/rest/v1/submissions')[0]?.body ?? '{}') as { payload: Record<string, unknown> };
    expect(row.payload).toEqual({ name: 'Ada' });
  });

  it('fails closed with 503 when Turnstile cannot be reached', async () => {
    upstream.form = { ...baseForm, enable_turnstile: true, turnstile_secret_key: 'secret-123' };
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('https://challenges.cloudflare.com/')) throw new Error('network down');
      return original(input, init);
    });
    const res = await send(jsonPost({ name: 'Ada', 'cf-turnstile-response': 'tok' }));
    expect(res.status).toBe(503);
  });
});

describe('quota', () => {
  it('rejects with 429 problem+json when the quota is exhausted and stores nothing', async () => {
    upstream.quotaOk = false;
    const res = await send(jsonPost({ name: 'Ada' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['type']).toBe('https://auklet.dev/problems/quota-exceeded');
    expect(body['status']).toBe(429);
    expect(callsTo('/rest/v1/submissions')).toHaveLength(0);
    expect(callsTo('api.resend.com')).toHaveLength(0);
  });
});

describe('CORS and routing', () => {
  it('answers allowed preflights with 204 and CORS headers', async () => {
    const res = await send(
      new Request(ENDPOINT, {
        method: 'OPTIONS',
        headers: { origin: 'https://example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    expect(res.headers.get('access-control-allow-methods')).toContain('POST');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
  });

  it('rejects disallowed origins with 403 on preflight and on POST, without CORS headers', async () => {
    const pre = await send(new Request(ENDPOINT, { method: 'OPTIONS', headers: { origin: 'https://evil.io' } }));
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();

    const post = await send(jsonPost({ name: 'Ada' }, { origin: 'https://evil.io' }));
    expect(post.status).toBe(403);
    expect(callsTo('consume_submission_quota')).toHaveLength(0);
  });

  it('allows any origin with * when allowed_domains is empty', async () => {
    upstream.form = { ...baseForm, allowed_domains: [] };
    const res = await send(jsonPost({ name: 'Ada' }, { origin: 'https://anything.io' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('returns 404 for unknown forms and malformed ids, 405 for other methods', async () => {
    upstream.form = null;
    expect((await send(jsonPost({ name: 'Ada' }))).status).toBe(404);
    expect((await send(new Request('https://api.test/v1/f/not-a-uuid', { method: 'POST' }))).status).toBe(404);
    expect((await send(new Request('https://api.test/nope'))).status).toBe(404);

    const get = await send(new Request(ENDPOINT, { method: 'GET' }));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('returns 415 for unsupported content types and 400 for empty submissions', async () => {
    const text = await send(new Request(ENDPOINT, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'hello' }));
    expect(text.status).toBe(415);
    const empty = await send(jsonPost({}));
    expect(empty.status).toBe(400);
  });

  it('returns 500 problem+json without leaking details when the Worker is misconfigured', async () => {
    const env = { ...makeEnv(), RESEND_API_KEY: '' };
    const res = await send(jsonPost({ name: 'Ada' }), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['type']).toBe('https://auklet.dev/problems/server-misconfigured');
    expect(JSON.stringify(body)).not.toContain('RESEND');
  });
});

describe('form config cache', () => {
  it('reads Supabase once and serves later requests from KV', async () => {
    await send(jsonPost({ name: 'one' }));
    await send(jsonPost({ name: 'two' }));
    await send(jsonPost({ name: 'three' }));
    expect(callsTo('/rest/v1/forms')).toHaveLength(1);
    expect(kv.has(`form:${FORM_ID}`)).toBe(true);
  });

  it('caches "not found" so unknown ids do not hammer the database', async () => {
    upstream.form = null;
    await send(jsonPost({ name: 'a' }));
    await send(jsonPost({ name: 'b' }));
    expect(callsTo('/rest/v1/forms')).toHaveLength(1);
  });

  it('returns 503 when Supabase is down and the cache is cold', async () => {
    vi.stubGlobal('fetch', async () => new Response('nope', { status: 500 }));
    const res = await send(jsonPost({ name: 'Ada' }));
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('5');
  });

  it('returns 503, not 500, when Supabase answers with a body that is not JSON', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>gateway error</html>', { status: 200 }));
    const res = await send(jsonPost({ name: 'Ada' }));
    expect(res.status).toBe(503);
  });
});
