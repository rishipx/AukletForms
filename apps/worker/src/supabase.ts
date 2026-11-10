import { log } from './log';
import { problems } from './problem';
import type { Env, FormConfig, NotifyStatus, SubmissionRow } from './types';
import { isRecord } from './types';

/**
 * Minimal PostgREST client. Uses fetch directly (no supabase-js) to keep the
 * Worker small and cold starts fast. All calls use the service-role key, which
 * bypasses RLS, so this module must only ever run server-side.
 */

const FORM_COLUMNS = 'id,user_id,name,target_email,allowed_domains,redirect_url,slack_webhook_url,discord_webhook_url,enable_turnstile,turnstile_secret_key';
const SYNC_TIMEOUT_MS = 4000;
const INSERT_TIMEOUT_MS = 8000;

function restBase(env: Env): string {
  return `${env.SUPABASE_URL.replace(/\/+$/, '')}/rest/v1`;
}

function authHeaders(env: Env): Record<string, string> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers: Record<string, string> = { apikey: key, 'content-type': 'application/json' };
  // Legacy service_role keys are JWTs and go in Authorization too; new `sb_secret_` keys must not.
  if (key.startsWith('eyJ')) headers['authorization'] = `Bearer ${key}`;
  return headers;
}

/** Parses a PostgREST response body, mapping a malformed one to a 503 instead of an unhandled error. */
async function readJson(res: Response, what: string, context: Record<string, unknown>): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    log('error', `supabase ${what} returned a body that is not JSON`, context);
    throw problems.upstreamUnavailable();
  }
}

function isStringOrNull(v: unknown): v is string | null {
  return v === null || typeof v === 'string';
}

export function isFormConfig(row: unknown): row is FormConfig {
  return (
    isRecord(row) &&
    typeof row['id'] === 'string' &&
    typeof row['user_id'] === 'string' &&
    typeof row['name'] === 'string' &&
    typeof row['target_email'] === 'string' &&
    Array.isArray(row['allowed_domains']) &&
    row['allowed_domains'].every((d) => typeof d === 'string') &&
    isStringOrNull(row['redirect_url']) &&
    isStringOrNull(row['slack_webhook_url']) &&
    isStringOrNull(row['discord_webhook_url']) &&
    typeof row['enable_turnstile'] === 'boolean' &&
    isStringOrNull(row['turnstile_secret_key'])
  );
}

/** Returns null when the form does not exist. Throws a 503 ProblemError if Supabase misbehaves. */
export async function fetchForm(env: Env, formId: string): Promise<FormConfig | null> {
  const url = `${restBase(env)}/forms?select=${FORM_COLUMNS}&id=eq.${encodeURIComponent(formId)}&limit=1`;
  let res: Response;
  try {
    res = await fetch(url, { headers: authHeaders(env), signal: AbortSignal.timeout(SYNC_TIMEOUT_MS) });
  } catch (err) {
    log('error', 'supabase forms request failed', { formId, error: String(err) });
    throw problems.upstreamUnavailable();
  }
  if (!res.ok) {
    log('error', 'supabase forms lookup failed', { formId, status: res.status });
    throw problems.upstreamUnavailable();
  }
  const rows = await readJson(res, 'forms lookup', { formId });
  if (!Array.isArray(rows)) {
    log('error', 'supabase forms lookup returned non-array', { formId });
    throw problems.upstreamUnavailable();
  }
  if (rows.length === 0) return null;
  const row: unknown = rows[0];
  if (!isFormConfig(row)) {
    log('error', 'supabase forms row has unexpected shape', { formId });
    throw problems.upstreamUnavailable();
  }
  return row;
}

/**
 * Atomically check and consume one submission slot (see supabase/migrations).
 * TRUE = slot consumed, FALSE = quota exhausted.
 */
export async function consumeQuota(env: Env, userId: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${restBase(env)}/rpc/consume_submission_quota`, {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify({ p_user_id: userId }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
  } catch (err) {
    log('error', 'supabase quota request failed', { userId, error: String(err) });
    throw problems.upstreamUnavailable();
  }
  if (!res.ok) {
    log('error', 'supabase quota rpc failed', { userId, status: res.status });
    throw problems.upstreamUnavailable();
  }
  const result = await readJson(res, 'quota rpc', { userId });
  if (typeof result !== 'boolean') {
    log('error', 'supabase quota rpc returned non-boolean', { userId });
    throw problems.upstreamUnavailable();
  }
  return result;
}

/** Throws a plain Error on failure; the caller (a background task) logs it. */
export async function insertSubmission(env: Env, row: SubmissionRow): Promise<void> {
  const res = await fetch(`${restBase(env)}/submissions`, {
    method: 'POST',
    headers: { ...authHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`insert into submissions failed: HTTP ${res.status} ${detail}`);
  }
}

export type EmailBudget = 'ok' | 'form_cap' | 'global_cap';

/**
 * Atomically reserve one notification email against the per-form and global daily caps.
 * Fails OPEN (returns 'ok') if the database cannot be reached: the submission is still
 * worth notifying, and Resend itself enforces the hard limit.
 */
export async function reserveEmailSlot(env: Env, formId: string, formCap: number, globalCap: number): Promise<EmailBudget> {
  try {
    const res = await fetch(`${restBase(env)}/rpc/consume_email_slot`, {
      method: 'POST',
      headers: authHeaders(env),
      body: JSON.stringify({ p_form_id: formId, p_form_cap: formCap, p_global_cap: globalCap }),
      signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const verdict: unknown = await res.json();
    if (verdict === 'ok' || verdict === 'form_cap' || verdict === 'global_cap') return verdict;
    throw new Error('unexpected RPC result');
  } catch (err) {
    log('warn', 'email budget check failed, sending anyway', { formId, error: String(err) });
    return 'ok';
  }
}

/** Records the final email outcome on an already-inserted submission. */
export async function updateNotifyStatus(env: Env, submissionId: string, status: NotifyStatus): Promise<void> {
  const res = await fetch(`${restBase(env)}/submissions?id=eq.${encodeURIComponent(submissionId)}`, {
    method: 'PATCH',
    headers: { ...authHeaders(env), prefer: 'return=minimal' },
    body: JSON.stringify({ notify_status: status }),
    signal: AbortSignal.timeout(INSERT_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`update notify_status failed: HTTP ${res.status}`);
}

/** Daily maintenance: retention purge. Doubles as the activity that keeps a free Supabase project awake. */
export async function purgeOldData(env: Env): Promise<unknown> {
  const res = await fetch(`${restBase(env)}/rpc/purge_old_data`, {
    method: 'POST',
    headers: authHeaders(env),
    body: '{}',
    signal: AbortSignal.timeout(INSERT_TIMEOUT_MS * 2),
  });
  if (!res.ok) throw new Error(`purge_old_data failed: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}
