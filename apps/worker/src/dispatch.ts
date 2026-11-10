import { buildDiscordMessage, buildEmail, buildSlackMessage, findReplyTo, type SubmissionView } from './format';
import { errorMessage, log } from './log';
import { insertSubmission, reserveEmailSlot, updateNotifyStatus } from './supabase';
import type { Env, FormConfig, SubmissionRow } from './types';

const RESEND_URL = 'https://api.resend.com/emails';
const ATTEMPT_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 300;

/**
 * Webhook targets are limited to the real Slack and Discord hosts. Without this
 * the Worker would be a free "POST JSON to any https URL" relay for anyone who
 * can create a form.
 */
const SLACK_HOSTS: ReadonlySet<string> = new Set(['hooks.slack.com']);
const DISCORD_HOSTS: ReadonlySet<string> = new Set(['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com']);

export function isAllowedWebhook(raw: string, hosts: ReadonlySet<string>): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && hosts.has(url.hostname) && url.username === '' && url.password === '';
  } catch {
    return false;
  }
}

/**
 * Resend rejects any request without a User-Agent (403, error code 1010), and
 * Workers' fetch() does not add one. Set it on every outbound call.
 */
const USER_AGENT = 'auklet-worker/1.0 (+https://auklet.dev)';

/** One retry on a network error, 429 or 5xx. Each attempt gets its own timeout. */
async function postWithRetry(url: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has('user-agent')) headers.set('user-agent', USER_AGENT);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise<void>((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      const res = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      if (res.status !== 429 && res.status < 500) return res;
      lastError = new Error(`HTTP ${res.status}`);
      if (attempt === 1) return res;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function assertOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const detail = (await res.text().catch(() => '')).slice(0, 300);
  throw new Error(`${label} failed: HTTP ${res.status} ${detail}`);
}

async function sendEmail(env: Env, form: FormConfig, view: SubmissionView): Promise<void> {
  const { subject, html, text } = buildEmail(form, view);
  const replyTo = findReplyTo(view.payload);
  const res = await postWithRetry(RESEND_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      'content-type': 'application/json',
      // Makes the retry above safe: Resend de-duplicates on this key.
      'idempotency-key': `auklet-${view.id}`,
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [form.target_email],
      subject,
      html,
      text,
      ...(replyTo !== null ? { reply_to: replyTo } : {}),
    }),
  });
  await assertOk(res, 'resend email');
}

async function sendWebhook(url: string, payload: Record<string, unknown>, label: string): Promise<void> {
  const res = await postWithRetry(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await assertOk(res, label);
}

const DEFAULT_GLOBAL_EMAIL_CAP = 90; // Resend's free plan allows 100 a day; leave headroom
const DEFAULT_FORM_EMAIL_CAP = 25;

function capFrom(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Everything that happens after the visitor already has their response.
 *
 * The email budget is settled first, because it decides what gets stored in
 * `notify_status`: spam is stored but never emailed, and once a form (or the whole
 * service) has used its daily email budget the submission is still stored and still
 * relayed to Slack/Discord, with `skipped_cap` shown in the dashboard.
 *
 * Tasks then run concurrently and independently: a database failure must not stop
 * the notification email, and vice versa. Never rejects.
 */
export async function processSubmission(env: Env, form: FormConfig, row: SubmissionRow, origin: string | null, requestId: string): Promise<void> {
  const view: SubmissionView = { id: row.id, payload: row.payload, createdAt: new Date().toISOString(), origin };

  if (row.is_spam) {
    row.notify_status = 'skipped_spam';
  } else {
    const budget = await reserveEmailSlot(
      env,
      form.id,
      capFrom(env.EMAIL_DAILY_FORM_CAP, DEFAULT_FORM_EMAIL_CAP),
      capFrom(env.EMAIL_DAILY_GLOBAL_CAP, DEFAULT_GLOBAL_EMAIL_CAP),
    );
    if (budget === 'ok') {
      row.notify_status = 'pending';
    } else {
      row.notify_status = 'skipped_cap';
      log('warn', 'daily email budget used up, email skipped', { formId: form.id, scope: budget, requestId });
    }
  }
  const emailAttempted = row.notify_status === 'pending';

  const tasks: Array<{ name: string; run: () => Promise<void> }> = [{ name: 'db_insert', run: () => insertSubmission(env, row) }];
  if (emailAttempted) tasks.push({ name: 'email', run: () => sendEmail(env, form, view) });

  if (!row.is_spam && form.slack_webhook_url !== null) {
    const url = form.slack_webhook_url;
    if (isAllowedWebhook(url, SLACK_HOSTS)) {
      tasks.push({ name: 'slack', run: () => sendWebhook(url, buildSlackMessage(form, view), 'slack webhook') });
    } else {
      log('warn', 'slack webhook url rejected: host not allowed', { formId: form.id, requestId });
    }
  }
  if (!row.is_spam && form.discord_webhook_url !== null) {
    const url = form.discord_webhook_url;
    if (isAllowedWebhook(url, DISCORD_HOSTS)) {
      tasks.push({ name: 'discord', run: () => sendWebhook(url, buildDiscordMessage(form, view), 'discord webhook') });
    } else {
      log('warn', 'discord webhook url rejected: host not allowed', { formId: form.id, requestId });
    }
  }

  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const outcome = new Map<string, boolean>();
  results.forEach((result, i) => {
    const name = tasks[i]?.name ?? 'unknown';
    outcome.set(name, result.status === 'fulfilled');
    if (result.status === 'rejected') {
      log('error', 'background task failed', {
        task: name,
        formId: form.id,
        submissionId: row.id,
        requestId,
        error: errorMessage(result.reason),
      });
    }
  });

  // Replace "pending" with the real outcome, but only if the row exists to be updated.
  if (emailAttempted && outcome.get('db_insert') === true) {
    await updateNotifyStatus(env, row.id, outcome.get('email') === true ? 'sent' : 'failed').catch((err: unknown) => {
      log('error', 'could not record notify status', { submissionId: row.id, requestId, error: errorMessage(err) });
    });
  }
}
