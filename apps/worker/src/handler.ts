import { loadFormConfig } from './config';
import { decideCors, preflightHeaders } from './cors';
import { processSubmission } from './dispatch';
import { errorMessage, log } from './log';
import { contentMime, parseBody } from './parse';
import { baseHeaders, thankYouPage } from './pages';
import { problemResponse, problems, ProblemError } from './problem';
import { decryptSecret } from './secrets';
import { extractControlFields, looksLikeSpam } from './spam';
import { consumeQuota } from './supabase';
import { verifyTurnstile } from './turnstile';
import type { Env, FormConfig, SubmissionRow } from './types';

const FORM_PATH = /^\/v1\/f\/([^/]+)\/?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 1_048_576; // 1 MiB on the wire (file parts are described, never stored)
const MAX_PAYLOAD_BYTES = 65_536; // 64 KiB of stored text fields; the database enforces 128 KiB as a backstop
const MAX_USER_AGENT_LENGTH = 512;

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const requestId = request.headers.get('cf-ray') ?? crypto.randomUUID();
  try {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true }, { headers: baseHeaders() });
    }
    if (url.pathname === '/thanks') {
      return thankYouPage();
    }

    const match = FORM_PATH.exec(url.pathname);
    if (match === null) throw problems.notFound();
    return await handleForm(request, env, ctx, (match[1] ?? '').toLowerCase(), requestId);
  } catch (err) {
    return errorResponse(err, requestId);
  }
}

async function handleForm(request: Request, env: Env, ctx: ExecutionContext, formId: string, requestId: string): Promise<Response> {
  if (!UUID_RE.test(formId)) throw problems.notFound('No form exists with that id.');
  if (request.method !== 'POST' && request.method !== 'OPTIONS') throw problems.methodNotAllowed();
  assertConfigured(env);

  // First thing for real submissions, before any KV read or database call, so a flood costs almost nothing.
  if (request.method === 'POST') await enforceRateLimit(request, env, formId);

  // CORS headers are attached to every response once the origin is vetted, so
  // browser clients can read problem+json errors too.
  let corsHeaders: Record<string, string> = {};
  try {
    const form = await loadFormConfig(env, ctx, formId);
    if (form === null) throw problems.notFound('No form exists with that id.');

    const cors = decideCors(request, form.allowed_domains);
    if (!cors.allowed) throw problems.originNotAllowed();
    corsHeaders = cors.headers;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...baseHeaders(), ...preflightHeaders(request, corsHeaders) } });
    }

    return await acceptSubmission(request, env, ctx, form, corsHeaders, requestId);
  } catch (err) {
    return errorResponse(err, requestId, corsHeaders);
  }
}

async function acceptSubmission(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  form: FormConfig,
  corsHeaders: Record<string, string>,
  requestId: string,
): Promise<Response> {
  const json = wantsJson(request);
  const clientIp = request.headers.get('cf-connecting-ip');

  const { cleaned, honeypotTripped, turnstileToken } = extractControlFields(await parseBody(request, MAX_BODY_BYTES));

  // Bots get a convincing success and nothing else: no DB row, no email, no quota used.
  if (honeypotTripped) {
    log('info', 'honeypot tripped', { formId: form.id, requestId });
    return successResponse(request, env, form, json, crypto.randomUUID(), corsHeaders);
  }

  if (Object.keys(cleaned).length === 0) {
    throw problems.invalidBody('The submission contains no fields.');
  }
  if (new TextEncoder().encode(JSON.stringify(cleaned)).length > MAX_PAYLOAD_BYTES) {
    throw problems.submissionTooLarge(MAX_PAYLOAD_BYTES);
  }

  if (form.enable_turnstile) {
    if (form.turnstile_secret_key === null || form.turnstile_secret_key === '') {
      log('error', 'turnstile enabled without a secret', { formId: form.id, requestId });
      throw problems.misconfigured();
    }
    if (turnstileToken === null || turnstileToken === '') throw problems.turnstileRequired();

    let verdict;
    try {
      // The stored key is encrypted; it is decrypted only here, in memory, for this one call.
      const secret = await decryptSecret(form.turnstile_secret_key, env.TURNSTILE_ENC_KEY);
      verdict = await verifyTurnstile(secret, turnstileToken, clientIp);
    } catch (err) {
      log('error', 'turnstile verification unavailable', { formId: form.id, requestId, error: errorMessage(err) });
      throw problems.upstreamUnavailable('Bot verification is temporarily unavailable. Please retry shortly.');
    }
    if (!verdict.success) throw problems.turnstileFailed(verdict.errorCodes);
  }

  // Atomic check-and-increment, only for submissions that passed every bot filter.
  if (!(await consumeQuota(env, form.user_id))) {
    log('info', 'quota exceeded', { formId: form.id, requestId });
    throw problems.quotaExceeded();
  }

  // The id is generated here so it can be returned now and used as the row id later.
  const row: SubmissionRow = {
    id: crypto.randomUUID(),
    form_id: form.id,
    payload: cleaned,
    submitter_ip: clientIp,
    user_agent: request.headers.get('user-agent')?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    is_spam: looksLikeSpam(cleaned),
    notify_status: 'pending',
  };

  ctx.waitUntil(
    processSubmission(env, form, row, request.headers.get('origin') ?? request.headers.get('referer'), requestId).catch((err: unknown) => {
      log('error', 'submission processing crashed', { submissionId: row.id, requestId, error: errorMessage(err) });
    }),
  );

  return successResponse(request, env, form, json, row.id, corsHeaders);
}

/**
 * JSON for programmatic clients, redirect for native browser form posts.
 * Native form posts always carry `Sec-Fetch-Mode: navigate`; fetch()/XHR send
 * `cors`, and following a cross-origin 302 from fetch() would fail anyway.
 */
function wantsJson(request: Request): boolean {
  const accept = (request.headers.get('accept') ?? '').toLowerCase();
  return accept.includes('application/json') || contentMime(request) === 'application/json' || request.headers.get('sec-fetch-mode') === 'cors';
}

function successResponse(request: Request, env: Env, form: FormConfig, json: boolean, submissionId: string, corsHeaders: Record<string, string>): Response {
  if (json) {
    return Response.json({ success: true, id: submissionId }, { status: 200, headers: { ...baseHeaders(), ...corsHeaders } });
  }
  return new Response(null, {
    status: 302,
    headers: { ...baseHeaders(), location: redirectTarget(request, env, form) },
  });
}

function redirectTarget(request: Request, env: Env, form: FormConfig): string {
  const fallback = env.THANK_YOU_URL ?? new URL('/thanks', request.url).toString();
  if (form.redirect_url === null || form.redirect_url === '') return fallback;
  try {
    const target = new URL(form.redirect_url);
    return target.protocol === 'https:' || target.protocol === 'http:' ? target.toString() : fallback;
  } catch {
    return fallback;
  }
}

/** Per client IP and form. Fails open: a limiter outage must not take form submissions down. */
async function enforceRateLimit(request: Request, env: Env, formId: string): Promise<void> {
  if (env.RATE_LIMITER === undefined) return;
  try {
    const { success } = await env.RATE_LIMITER.limit({ key: `${request.headers.get('cf-connecting-ip') ?? 'unknown'}:${formId}` });
    if (!success) throw problems.rateLimited();
  } catch (err) {
    if (err instanceof ProblemError) throw err;
    log('warn', 'rate limiter unavailable', { error: errorMessage(err) });
  }
}

function assertConfigured(env: Env): void {
  const missing = (['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'EMAIL_FROM'] as const).filter(
    (name) => typeof env[name] !== 'string' || env[name] === '',
  );
  if (missing.length > 0 || env.FORM_CACHE === undefined) {
    log('error', 'worker is missing configuration', { missing, kv: env.FORM_CACHE !== undefined });
    throw problems.misconfigured();
  }
}

function errorResponse(err: unknown, requestId: string, corsHeaders: Record<string, string> = {}): Response {
  if (err instanceof ProblemError) return problemResponse(err, requestId, corsHeaders);
  log('error', 'unhandled error', { requestId, error: errorMessage(err) });
  return problemResponse(problems.internal(), requestId, corsHeaders);
}
