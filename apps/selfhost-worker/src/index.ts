/**
 * Auklet Forms, self-hosted edition.
 *
 * A single-file Cloudflare Worker that turns any HTML form or fetch() call into
 * an email. No database, no accounts, no dependencies.
 *
 *   POST /                 (also accepted: POST /v1/f/<anything>, so snippets
 *                           written for Auklet Cloud work after swapping the host)
 *   GET  /thanks           built-in thank-you page for plain HTML form posts
 *   GET  /healthz          liveness check
 *
 * Accepts application/json, application/x-www-form-urlencoded and multipart/form-data.
 * Spam trap: any populated `_gotcha`, `_botcheck` or `_honeypot` field is dropped silently.
 * Errors are RFC 7807 problem details (application/problem+json).
 *
 * Copyright (C) 2026 rishipx
 * SPDX-License-Identifier: AGPL-3.0-only
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU Affero General Public License, version 3. See the LICENSE file.
 */

export interface Env {
  /** Secret. Resend API key (re_...). */
  RESEND_API_KEY: string;
  /** Secret. Recipient address, or up to 10 comma-separated addresses. */
  TO_EMAIL: string;
  /** Sender, e.g. "Website <forms@yourdomain.com>". Defaults to Resend's sandbox sender. */
  FROM_EMAIL?: string;
  /** Comma-separated sites allowed to submit from a browser. Empty or "*" allows any site. */
  ALLOWED_ORIGINS?: string;
  /** Where plain HTML form posts are sent afterwards. Defaults to the built-in /thanks page. */
  REDIRECT_URL?: string;
  /** Email subject. Defaults to "New form submission". */
  SUBJECT?: string;
  /** Optional rate-limiting binding (see wrangler.toml). Used per client IP when present. */
  RATE_LIMITER?: RateLimit;
}

type Payload = Record<string, unknown>;

// ===========================================================================
// Limits and constants
// ===========================================================================

const MAX_BODY_BYTES = 1_048_576; // 1 MiB
const MAX_FIELDS = 200;
const MAX_RECIPIENTS = 10;
const RESEND_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Auklet Forms <onboarding@resend.dev>';
const DEFAULT_SUBJECT = 'New form submission';
const ATTEMPT_TIMEOUT_MS = 6000;
const RETRY_DELAY_MS = 300;
/** Resend rejects requests that have no User-Agent (403), and Workers' fetch() sends none. */
const USER_AGENT = 'auklet-forms-selfhost/1.0 (+https://auklet.dev)';
const HONEYPOT_FIELDS: ReadonlySet<string> = new Set(['_gotcha', '_botcheck', '_honeypot']);
const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const FORM_PATH = /^\/(?:v1\/f\/[^/]+\/?)?$/;

// ===========================================================================
// RFC 7807 problem details
// ===========================================================================

class ProblemError extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly title: string,
    detail: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
  }
}

const problems = {
  notFound: () => new ProblemError(404, 'not-found', 'Not Found', 'The requested resource does not exist.'),
  methodNotAllowed: () =>
    new ProblemError(405, 'method-not-allowed', 'Method Not Allowed', 'This endpoint accepts POST and OPTIONS requests only.', { allow: 'POST, OPTIONS' }),
  originNotAllowed: () => new ProblemError(403, 'origin-not-allowed', 'Origin Not Allowed', 'The request origin is not in ALLOWED_ORIGINS.'),
  unsupportedMediaType: () =>
    new ProblemError(
      415,
      'unsupported-media-type',
      'Unsupported Media Type',
      'Send the body as application/json, multipart/form-data or application/x-www-form-urlencoded.',
    ),
  payloadTooLarge: () => new ProblemError(413, 'payload-too-large', 'Payload Too Large', `The request body exceeds the ${MAX_BODY_BYTES}-byte limit.`),
  invalidBody: (detail: string) => new ProblemError(400, 'invalid-body', 'Invalid Request Body', detail),
  rateLimited: () =>
    new ProblemError(429, 'rate-limited', 'Too Many Requests', 'Too many submissions from your network. Please wait a minute and try again.', {
      'retry-after': '60',
    }),
  deliveryFailed: () =>
    new ProblemError(502, 'delivery-failed', 'Delivery Failed', 'Your message could not be delivered right now. Please try again shortly.', {
      'retry-after': '10',
    }),
  misconfigured: () =>
    new ProblemError(500, 'server-misconfigured', 'Server Misconfigured', 'This endpoint is not configured correctly. Please contact the site owner.'),
  internal: () => new ProblemError(500, 'internal-error', 'Internal Server Error', 'An unexpected error occurred.'),
};

function log(level: 'info' | 'warn' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  // Never log submission contents, API keys or recipient addresses.
  const line = JSON.stringify({ level, message, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function problemResponse(err: ProblemError, requestId: string, extra: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({
      type: `https://auklet.dev/problems/${err.slug}`,
      title: err.title,
      status: err.status,
      detail: err.message,
      requestId,
    }),
    {
      status: err.status,
      headers: { 'content-type': 'application/problem+json; charset=utf-8', ...baseHeaders(), ...extra, ...err.headers },
    },
  );
}

function baseHeaders(): Record<string, string> {
  return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
}

// ===========================================================================
// Configuration
// ===========================================================================

interface Config {
  apiKey: string;
  to: string[];
  from: string;
  subject: string;
  origins: string[];
  redirectUrl: string | null;
}

/** Validates settings on every request so a typo is reported clearly in the logs instead of failing mysteriously. */
function readConfig(env: Env): Config {
  const problemsFound: string[] = [];

  const apiKey = (env.RESEND_API_KEY ?? '').trim();
  if (apiKey === '') problemsFound.push('RESEND_API_KEY is not set');

  const to = (env.TO_EMAIL ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  if (to.length === 0) problemsFound.push('TO_EMAIL is not set');
  else if (to.length > MAX_RECIPIENTS) problemsFound.push(`TO_EMAIL has more than ${MAX_RECIPIENTS} addresses`);
  else if (to.some((address) => !EMAIL_RE.test(address))) problemsFound.push('TO_EMAIL contains an invalid email address');

  const from = (env.FROM_EMAIL ?? '').trim() || DEFAULT_FROM;
  const subject = singleLine(env.SUBJECT ?? '') || DEFAULT_SUBJECT;

  let redirectUrl: string | null = null;
  const rawRedirect = (env.REDIRECT_URL ?? '').trim();
  if (rawRedirect !== '') {
    redirectUrl = parseHttpUrl(rawRedirect);
    if (redirectUrl === null) problemsFound.push('REDIRECT_URL must be a full http(s) URL');
  }

  const origins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

  if (problemsFound.length > 0) {
    log('error', 'configuration problem', { problems: problemsFound });
    throw problems.misconfigured();
  }
  return { apiKey, to, from, subject: subject.slice(0, 150), origins: origins.includes('*') ? [] : origins, redirectUrl };
}

function parseHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function singleLine(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').trim();
}

// ===========================================================================
// CORS
//
// ALLOWED_ORIGINS entries look like `example.com`, `localhost:3000`, `*.example.com`
// or a full origin such as `https://example.com`. Hosts match exactly (case-insensitive,
// http and https both), the port must match, `*.example.com` matches subdomains only.
// ===========================================================================

interface AllowedEntry {
  hostname: string;
  port: string;
  wildcard: boolean;
}

function parseAllowedEntry(raw: string): AllowedEntry | null {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  let wildcard = false;
  if (s.startsWith('*.')) {
    wildcard = true;
    s = s.slice(2);
  }
  if (s === '' || s.includes('*') || s.includes('@')) return null;
  try {
    const url = new URL(`http://${s}`);
    return url.hostname === '' ? null : { hostname: url.hostname, port: url.port, wildcard };
  } catch {
    return null;
  }
}

function originMatches(origin: string, allowed: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  for (const raw of allowed) {
    const entry = parseAllowedEntry(raw);
    if (entry === null || entry.port !== url.port) continue;
    if (entry.wildcard ? url.hostname.endsWith(`.${entry.hostname}`) : url.hostname === entry.hostname) return true;
  }
  return false;
}

/** Returns CORS headers for an allowed request, or throws 403. */
function checkCors(request: Request, allowed: readonly string[]): Record<string, string> {
  if (allowed.length === 0) return { 'access-control-allow-origin': '*' };

  const origin = request.headers.get('origin');
  if (origin !== null) {
    if (!originMatches(origin, allowed)) throw problems.originNotAllowed();
    return { 'access-control-allow-origin': origin, vary: 'Origin' };
  }

  // Some native form posts omit Origin but still send Referer. With neither header
  // (curl, server-to-server) the request is allowed, since CORS only protects browsers.
  const referer = request.headers.get('referer');
  if (referer !== null) {
    try {
      if (!originMatches(new URL(referer).origin, allowed)) throw problems.originNotAllowed();
    } catch (err) {
      if (err instanceof ProblemError) throw err;
    }
  }
  return { vary: 'Origin' };
}

// ===========================================================================
// Request body parsing
// ===========================================================================

function contentMime(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

async function readBody(request: Request): Promise<Uint8Array> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw problems.payloadTooLarge();
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw problems.payloadTooLarge();
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Repeated keys become arrays. Built from a Map so a `__proto__` field stays plain data. */
function collect(entries: Iterable<[string, unknown]>): Payload {
  const map = new Map<string, unknown>();
  for (const [key, value] of entries) {
    if (!map.has(key) && map.size >= MAX_FIELDS) throw problems.invalidBody(`A submission may contain at most ${MAX_FIELDS} fields.`);
    const existing = map.get(key);
    if (existing === undefined) map.set(key, value);
    else if (Array.isArray(existing)) existing.push(value);
    else map.set(key, [existing, value]);
  }
  return Object.fromEntries(map);
}

async function parseBody(request: Request): Promise<Payload> {
  const mime = contentMime(request);
  if (mime !== 'application/json' && mime !== 'application/x-www-form-urlencoded' && mime !== 'multipart/form-data') {
    throw problems.unsupportedMediaType();
  }
  const bytes = await readBody(request);

  if (mime === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw problems.invalidBody('The request body is not valid JSON.');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw problems.invalidBody('The JSON body must be an object of field names to values.');
    }
    if (Object.keys(parsed).length > MAX_FIELDS) throw problems.invalidBody(`A submission may contain at most ${MAX_FIELDS} fields.`);
    return parsed as Payload;
  }

  if (mime === 'application/x-www-form-urlencoded') {
    return collect(new URLSearchParams(new TextDecoder().decode(bytes)).entries());
  }

  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData();
  } catch {
    throw problems.invalidBody('The multipart/form-data body is malformed.');
  }
  const entries: Array<[string, unknown]> = [];
  // Uploaded files are not stored or attached; the email notes that one was sent.
  form.forEach((value, key) => {
    entries.push([key, typeof value === 'string' ? value : { filename: value.name, size: value.size, contentType: value.type, attached: false }]);
  });
  return collect(entries);
}

// ===========================================================================
// Spam trap
// ===========================================================================

function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some(isPopulated);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function splitHoneypot(payload: Payload): { cleaned: Payload; tripped: boolean } {
  let tripped = false;
  const kept: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(payload)) {
    if (HONEYPOT_FIELDS.has(key)) {
      if (isPopulated(value)) tripped = true;
    } else {
      kept.push([key, value]);
    }
  }
  return { cleaned: Object.fromEntries(kept), tripped };
}

// ===========================================================================
// Email
// ===========================================================================

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringify).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** If the visitor supplied an email address, use it as Reply-To so "Reply" just works. */
function findReplyTo(payload: Payload): string | null {
  for (const [key, value] of Object.entries(payload)) {
    const k = key.toLowerCase();
    if ((k === 'email' || k === 'e-mail' || k === '_replyto' || k === '_reply_to') && typeof value === 'string') {
      const candidate = value.trim();
      if (candidate.length <= 254 && EMAIL_RE.test(candidate)) return candidate;
    }
  }
  return null;
}

function buildEmail(payload: Payload, id: string, receivedAt: string, source: string | null) {
  const entries = Object.entries(payload);
  const shown = entries.slice(0, 100).map(([key, value]) => ({ key: truncate(key, 100), value: truncate(stringify(value), 5000) }));
  const omitted = entries.length - shown.length;

  const rows = shown
    .map(
      (f) =>
        `<tr><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#374151;vertical-align:top;white-space:nowrap">${escapeHtml(f.key)}</td>` +
        `<td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;color:#111827;white-space:pre-wrap;word-break:break-word">${escapeHtml(f.value) || '&mdash;'}</td></tr>`,
    )
    .join('');

  const html =
    `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">` +
    `<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">` +
    `<div style="padding:18px 20px;border-bottom:1px solid #e5e7eb;font-size:18px;font-weight:700;color:#111827">New form submission</div>` +
    `<table role="presentation" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px">${rows}</table>` +
    `<div style="padding:14px 20px;background:#f9fafb;color:#6b7280;font-size:12px">` +
    (omitted > 0 ? `…and ${omitted} more field${omitted === 1 ? '' : 's'} not shown.<br>` : '') +
    `Received ${escapeHtml(receivedAt)}${source !== null ? ` &middot; from ${escapeHtml(source)}` : ''}<br>Submission ID ${escapeHtml(id)}</div>` +
    `</div></body></html>`;

  const text =
    shown.map((f) => `${f.key}: ${f.value}`).join('\n') +
    (omitted > 0 ? `\n\n…and ${omitted} more field${omitted === 1 ? '' : 's'} not shown.` : '') +
    `\n\nReceived ${receivedAt}${source !== null ? ` from ${source}` : ''}\nSubmission ID ${id}\n`;

  return { html, text };
}

/**
 * Sends through Resend and WAITS for the result. With no database behind it,
 * a background send that failed would silently lose the message; waiting lets
 * us tell the visitor to retry instead. One retry on network errors, 429 and 5xx,
 * made safe by the Idempotency-Key (Resend de-duplicates repeats for 24 hours).
 */
async function deliver(config: Config, payload: Payload, id: string, source: string | null): Promise<void> {
  const { html, text } = buildEmail(payload, id, new Date().toISOString(), source);
  const replyTo = findReplyTo(payload);
  const body = JSON.stringify({
    from: config.from,
    to: config.to,
    subject: config.subject,
    html,
    text,
    ...(replyTo !== null ? { reply_to: replyTo } : {}),
  });

  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const res = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
          'user-agent': USER_AGENT,
          'idempotency-key': `auklet-${id}`,
        },
        body,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      if (res.ok) return;

      lastStatus = res.status;
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      log('error', 'resend rejected the email', { status: res.status, detail, attempt: attempt + 1 });
      if (res.status !== 429 && res.status < 500) break; // 401/403/422 will not improve on retry
    } catch (err) {
      log('error', 'resend request failed', { error: err instanceof Error ? err.message : String(err), attempt: attempt + 1 });
    }
  }
  log('error', 'delivery failed', { id, lastStatus });
  throw problems.deliveryFailed();
}

// ===========================================================================
// Request handling
// ===========================================================================

const THANK_YOU_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Thank you</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#f9fafb;color:#111827}main{max-width:28rem;padding:2rem;text-align:center}h1{font-size:1.5rem;margin:0 0 .5rem}p{margin:0;color:#4b5563;line-height:1.5}@media(prefers-color-scheme:dark){body{background:#111827;color:#f9fafb}p{color:#9ca3af}}</style>
</head><body><main><h1>Thank you!</h1><p>Your message has been sent. You can safely close this tab or go back.</p></main></body></html>`;

/** JSON for programmatic clients, a redirect for native browser form posts (which send Sec-Fetch-Mode: navigate). */
function wantsJson(request: Request): boolean {
  return (
    (request.headers.get('accept') ?? '').toLowerCase().includes('application/json') ||
    contentMime(request) === 'application/json' ||
    request.headers.get('sec-fetch-mode') === 'cors'
  );
}

function success(request: Request, config: Config, id: string, cors: Record<string, string>): Response {
  if (wantsJson(request)) {
    return Response.json({ success: true, id }, { headers: { ...baseHeaders(), ...cors } });
  }
  const location = config.redirectUrl ?? new URL('/thanks', request.url).toString();
  return new Response(null, { status: 302, headers: { ...baseHeaders(), location } });
}

async function handleSubmission(request: Request, env: Env, requestId: string): Promise<Response> {
  const config = readConfig(env);
  const cors = checkCors(request, config.origins);
  // From here on, errors carry CORS headers so browser clients can read them.
  try {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...baseHeaders(),
          ...cors,
          ...(cors['access-control-allow-origin'] !== undefined
            ? {
                'access-control-allow-methods': 'POST, OPTIONS',
                'access-control-allow-headers': request.headers.get('access-control-request-headers') ?? 'Content-Type, Accept',
                'access-control-max-age': '86400',
              }
            : {}),
        },
      });
    }

    await enforceRateLimit(request, env);

    const { cleaned, tripped } = splitHoneypot(await parseBody(request));
    const id = crypto.randomUUID();

    // Bots get a convincing success and nothing else: no email is sent.
    if (tripped) {
      log('info', 'honeypot tripped', { requestId });
      return success(request, config, id, cors);
    }
    if (Object.keys(cleaned).length === 0) throw problems.invalidBody('The submission contains no fields.');

    await deliver(config, cleaned, id, request.headers.get('origin') ?? request.headers.get('referer'));
    return success(request, config, id, cors);
  } catch (err) {
    return toResponse(err, requestId, cors);
  }
}

async function enforceRateLimit(request: Request, env: Env): Promise<void> {
  if (env.RATE_LIMITER === undefined) return;
  try {
    const { success: allowed } = await env.RATE_LIMITER.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!allowed) throw problems.rateLimited();
  } catch (err) {
    if (err instanceof ProblemError) throw err;
    // The limiter is abuse protection, not a gate: if it misbehaves, keep accepting real submissions.
    log('warn', 'rate limiter unavailable', { error: err instanceof Error ? err.message : String(err) });
  }
}

function toResponse(err: unknown, requestId: string, cors: Record<string, string> = {}): Response {
  if (err instanceof ProblemError) return problemResponse(err, requestId, cors);
  log('error', 'unhandled error', { requestId, error: err instanceof Error ? err.message : String(err) });
  return problemResponse(problems.internal(), requestId, cors);
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
  try {
    const { pathname } = new URL(request.url);

    if (pathname === '/healthz') return Response.json({ ok: true }, { headers: baseHeaders() });
    if (pathname === '/thanks') {
      return new Response(THANK_YOU_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
      });
    }
    if (!FORM_PATH.test(pathname)) throw problems.notFound();
    if (request.method !== 'POST' && request.method !== 'OPTIONS') throw problems.methodNotAllowed();

    return await handleSubmission(request, env, requestId);
  } catch (err) {
    return toResponse(err, requestId);
  }
}

export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleRequest(request, env),
} satisfies ExportedHandler<Env>;
