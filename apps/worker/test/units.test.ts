import { describe, expect, it } from 'vitest';
import { decideCors, originMatches, parseAllowedEntry } from '../src/cors';
import { isAllowedWebhook } from '../src/dispatch';
import { buildDiscordMessage, buildEmail, buildSlackMessage, escapeHtml, findReplyTo } from '../src/format';
import { parseBody } from '../src/parse';
import { ProblemError } from '../src/problem';
import { extractControlFields, isPopulated } from '../src/spam';
import type { FormConfig } from '../src/types';

const FORM: FormConfig = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  name: 'Contact <script>',
  target_email: 'owner@example.com',
  allowed_domains: [],
  redirect_url: null,
  slack_webhook_url: null,
  discord_webhook_url: null,
  enable_turnstile: false,
  turnstile_secret_key: null,
};

describe('allowed domain matching', () => {
  it('matches exact hosts regardless of scheme and case', () => {
    expect(originMatches('https://Example.com', ['example.com'])).toBe(true);
    expect(originMatches('http://example.com', ['example.com'])).toBe(true);
  });

  it('requires the port to match', () => {
    expect(originMatches('http://localhost:3000', ['localhost:3000'])).toBe(true);
    expect(originMatches('http://localhost:4000', ['localhost:3000'])).toBe(false);
    expect(originMatches('http://localhost:3000', ['localhost'])).toBe(false);
  });

  it('does not treat subdomains or look-alikes as matches', () => {
    expect(originMatches('https://evil-example.com', ['example.com'])).toBe(false);
    expect(originMatches('https://example.com.evil.io', ['example.com'])).toBe(false);
    expect(originMatches('https://app.example.com', ['example.com'])).toBe(false);
  });

  it('supports explicit wildcards for subdomains only', () => {
    expect(originMatches('https://app.example.com', ['*.example.com'])).toBe(true);
    expect(originMatches('https://a.b.example.com', ['*.example.com'])).toBe(true);
    expect(originMatches('https://example.com', ['*.example.com'])).toBe(false);
  });

  it('tolerates pasted schemes and paths, and ignores junk entries', () => {
    expect(parseAllowedEntry('https://example.com/contact')).toEqual({ hostname: 'example.com', port: '', wildcard: false });
    expect(parseAllowedEntry('')).toBeNull();
    expect(parseAllowedEntry('ex*ample.com')).toBeNull();
    expect(originMatches('https://example.com', ['', '***'])).toBe(false);
  });

  it('rejects the "null" origin and non-http schemes', () => {
    expect(originMatches('null', ['example.com'])).toBe(false);
    expect(originMatches('file:///tmp/x.html', ['example.com'])).toBe(false);
  });
});

describe('decideCors', () => {
  const req = (headers: Record<string, string>) => new Request('https://api.test/v1/f/x', { method: 'POST', headers });

  it('allows any origin with * when the allow-list is empty', () => {
    const d = decideCors(req({ origin: 'https://anywhere.io' }), []);
    expect(d).toEqual({ allowed: true, headers: { 'access-control-allow-origin': '*' } });
  });

  it('echoes a matching origin and denies a non-matching one', () => {
    const ok = decideCors(req({ origin: 'https://example.com' }), ['example.com']);
    expect(ok).toEqual({ allowed: true, headers: { 'access-control-allow-origin': 'https://example.com', vary: 'Origin' } });
    expect(decideCors(req({ origin: 'https://evil.io' }), ['example.com'])).toEqual({ allowed: false });
  });

  it('allows requests with neither Origin nor Referer (server-to-server)', () => {
    expect(decideCors(req({}), ['example.com']).allowed).toBe(true);
  });

  it('falls back to Referer when Origin is absent', () => {
    expect(decideCors(req({ referer: 'https://example.com/contact' }), ['example.com']).allowed).toBe(true);
    expect(decideCors(req({ referer: 'https://evil.io/page' }), ['example.com']).allowed).toBe(false);
  });
});

describe('honeypot and control fields', () => {
  it('treats only meaningful values as populated', () => {
    expect(isPopulated('')).toBe(false);
    expect(isPopulated('   ')).toBe(false);
    expect(isPopulated(null)).toBe(false);
    expect(isPopulated(false)).toBe(false);
    expect(isPopulated([])).toBe(false);
    expect(isPopulated('gotcha')).toBe(true);
    expect(isPopulated(true)).toBe(true);
    expect(isPopulated(['', 'x'])).toBe(true);
  });

  it('flags a populated honeypot and strips control fields from the payload', () => {
    const r = extractControlFields({ name: 'Ada', _gotcha: 'bot', 'cf-turnstile-response': 'tok' });
    expect(r.honeypotTripped).toBe(true);
    expect(r.turnstileToken).toBe('tok');
    expect(r.cleaned).toEqual({ name: 'Ada' });
  });

  it('ignores empty honeypots and checks all three names', () => {
    expect(extractControlFields({ name: 'Ada', _gotcha: '' }).honeypotTripped).toBe(false);
    expect(extractControlFields({ _botcheck: 'x' }).honeypotTripped).toBe(true);
    expect(extractControlFields({ _honeypot: 'x' }).honeypotTripped).toBe(true);
  });
});

describe('body parsing', () => {
  const post = (body: BodyInit, contentType?: string) =>
    new Request('https://api.test/v1/f/x', { method: 'POST', body, headers: contentType ? { 'content-type': contentType } : {} });

  it('parses JSON objects', async () => {
    const p = await parseBody(post(JSON.stringify({ a: 1, b: { c: 2 } }), 'application/json'), 1024);
    expect(p).toEqual({ a: 1, b: { c: 2 } });
  });

  it('parses urlencoded bodies and groups repeated keys', async () => {
    const p = await parseBody(post('name=Ada&tag=a&tag=b', 'application/x-www-form-urlencoded'), 1024);
    expect(p).toEqual({ name: 'Ada', tag: ['a', 'b'] });
  });

  it('parses multipart bodies and records file metadata without contents', async () => {
    const fd = new FormData();
    fd.append('name', 'Ada');
    fd.append('upload', new File(['hello'], 'cv.txt', { type: 'text/plain' }));
    const p = await parseBody(post(fd), 4096);
    expect(p['name']).toBe('Ada');
    expect(p['upload']).toEqual({ filename: 'cv.txt', size: 5, contentType: 'text/plain', stored: false });
  });

  it('keeps a __proto__ key as plain data', async () => {
    const p = await parseBody(post('__proto__=x&a=1', 'application/x-www-form-urlencoded'), 1024);
    expect(Object.getPrototypeOf(p)).toBe(Object.prototype);
    expect(Object.keys(p)).toContain('__proto__');
  });

  it('rejects unsupported media types, bad JSON, non-object JSON and oversized bodies', async () => {
    await expect(parseBody(post('hi', 'text/plain'), 1024)).rejects.toMatchObject({ status: 415 });
    await expect(parseBody(post('{oops', 'application/json'), 1024)).rejects.toMatchObject({ status: 400 });
    await expect(parseBody(post('[1,2]', 'application/json'), 1024)).rejects.toMatchObject({ status: 400 });
    await expect(parseBody(post('x'.repeat(2000), 'application/x-www-form-urlencoded'), 1024)).rejects.toBeInstanceOf(ProblemError);
    await expect(parseBody(post('x'.repeat(2000), 'application/x-www-form-urlencoded'), 1024)).rejects.toMatchObject({ status: 413 });
  });
});

describe('message formatting', () => {
  it('HTML-escapes submitter content and the form name in emails', () => {
    const { html, subject } = buildEmail(FORM, {
      id: 'sub-1',
      payload: { message: '<img src=x onerror=alert(1)>' },
      createdAt: '2026-10-23T00:00:00.000Z',
      origin: 'https://example.com',
    });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>');
    expect(subject).toBe('New submission: Contact <script>');
  });

  it('finds a valid reply-to address and refuses header-injection attempts', () => {
    expect(findReplyTo({ Email: ' ada@example.com ' })).toBe('ada@example.com');
    expect(findReplyTo({ email: 'ada@example.com\r\nBcc: x@y.z' })).toBeNull();
    expect(findReplyTo({ email: 'not-an-email' })).toBeNull();
  });

  it('disables mentions in Discord messages and escapes Slack control characters', () => {
    const view = { id: 's', payload: { msg: '@everyone <!channel> & more' }, createdAt: '2026-10-23T00:00:00.000Z', origin: null };
    expect(buildDiscordMessage(FORM, view)['allowed_mentions']).toEqual({ parse: [] });
    expect(JSON.stringify(buildSlackMessage(FORM, view))).toContain('&lt;!channel&gt; &amp; more');
    expect(escapeHtml(`"'&<>`)).toBe('&quot;&#39;&amp;&lt;&gt;');
  });

  it('only allows genuine Slack and Discord webhook hosts', () => {
    const slack = new Set(['hooks.slack.com']);
    expect(isAllowedWebhook('https://hooks.slack.com/services/T/B/x', slack)).toBe(true);
    expect(isAllowedWebhook('http://hooks.slack.com/services/T/B/x', slack)).toBe(false);
    expect(isAllowedWebhook('https://hooks.slack.com.evil.io/x', slack)).toBe(false);
    expect(isAllowedWebhook('https://user:pw@hooks.slack.com/x', slack)).toBe(false);
    expect(isAllowedWebhook('https://169.254.169.254/latest', slack)).toBe(false);
  });
});
