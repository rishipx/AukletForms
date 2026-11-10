import type { FieldErrors } from '@/lib/types';
import { isValidEmail } from '@/lib/utils';

/**
 * Server-side validation for form settings. Mirrors the CHECK constraints in the
 * database schema and the webhook host allow-list enforced by the Worker, so users
 * get a precise message here instead of a database error later.
 */

export const SLACK_HOSTS: readonly string[] = ['hooks.slack.com'];
export const DISCORD_HOSTS: readonly string[] = ['discord.com', 'ptb.discord.com', 'canary.discord.com', 'discordapp.com'];

export const MAX_NAME_LENGTH = 120;
export const MAX_DOMAINS = 50;

export interface FormInput {
  name: string;
  target_email: string;
  allowed_domains: string[];
  redirect_url: string | null;
  slack_webhook_url: string | null;
  discord_webhook_url: string | null;
  enable_turnstile: boolean;
  /** `undefined` means "leave the stored secret as it is" (edit form, field left blank). */
  turnstile_secret_key: string | null | undefined;
}

export type ParseResult = { ok: true; value: FormInput } | { ok: false; errors: FieldErrors };

/**
 * Normalizes `https://Example.com/contact`, `EXAMPLE.com`, `localhost:3000` or
 * `*.example.com` into the canonical form stored in allowed_domains
 * (host[:port], lowercase, optional `*.` prefix). Returns null when invalid.
 */
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (s === '') return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
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
    if (url.hostname === '') return null;
    return `${wildcard ? '*.' : ''}${url.hostname}${url.port !== '' ? `:${url.port}` : ''}`;
  } catch {
    return null;
  }
}

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function parseHttpUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function parseWebhook(raw: string, hosts: readonly string[], pathPrefix: string): string | null {
  try {
    const url = new URL(raw);
    const ok = url.protocol === 'https:' && hosts.includes(url.hostname) && url.username === '' && url.password === '' && url.pathname.startsWith(pathPrefix);
    return ok ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ParseOptions {
  /** True when the form already has a Turnstile secret stored, so a blank field means "keep it". */
  hasStoredSecret?: boolean;
}

export function parseFormInput(formData: FormData, options: ParseOptions = {}): ParseResult {
  const errors: FieldErrors = {};

  const name = text(formData, 'name');
  if (name === '') errors.name = 'Give the form a name.';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Use ${MAX_NAME_LENGTH} characters or fewer.`;

  const targetEmail = text(formData, 'target_email').toLowerCase();
  if (!isValidEmail(targetEmail)) {
    errors.target_email = 'Enter the email address that should receive submissions.';
  }

  const rawDomains = formData
    .getAll('allowed_domains')
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v !== '');
  const domains: string[] = [];
  const invalidDomains: string[] = [];
  for (const raw of rawDomains) {
    const normalized = normalizeDomain(raw);
    if (normalized === null) invalidDomains.push(raw);
    else if (!domains.includes(normalized)) domains.push(normalized);
  }
  if (invalidDomains.length > 0) {
    errors.allowed_domains = `Not a valid domain: ${invalidDomains.slice(0, 3).join(', ')}${invalidDomains.length > 3 ? '…' : ''}`;
  } else if (domains.length > MAX_DOMAINS) {
    errors.allowed_domains = `You can allow at most ${MAX_DOMAINS} domains.`;
  }

  let redirectUrl: string | null = null;
  const rawRedirect = text(formData, 'redirect_url');
  if (rawRedirect !== '') {
    redirectUrl = parseHttpUrl(rawRedirect);
    if (redirectUrl === null) errors.redirect_url = 'Enter a full http(s) URL, e.g. https://example.com/thanks.';
  }

  let slackUrl: string | null = null;
  const rawSlack = text(formData, 'slack_webhook_url');
  if (rawSlack !== '') {
    slackUrl = parseWebhook(rawSlack, SLACK_HOSTS, '/services/');
    if (slackUrl === null) errors.slack_webhook_url = 'Use a Slack incoming webhook URL (https://hooks.slack.com/services/…).';
  }

  let discordUrl: string | null = null;
  const rawDiscord = text(formData, 'discord_webhook_url');
  if (rawDiscord !== '') {
    discordUrl = parseWebhook(rawDiscord, DISCORD_HOSTS, '/api/webhooks/');
    if (discordUrl === null) errors.discord_webhook_url = 'Use a Discord webhook URL (https://discord.com/api/webhooks/…).';
  }

  const enableTurnstile = formData.get('enable_turnstile') === 'on';
  const rawSecret = text(formData, 'turnstile_secret_key');
  const keepStoredSecret = enableTurnstile && rawSecret === '' && options.hasStoredSecret === true;
  if (enableTurnstile && rawSecret === '' && !keepStoredSecret) errors.turnstile_secret_key = 'Paste your Turnstile secret key to turn bot protection on.';
  else if (rawSecret.length > 200) errors.turnstile_secret_key = 'That secret key looks too long.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      target_email: targetEmail,
      allowed_domains: domains,
      redirect_url: redirectUrl,
      slack_webhook_url: slackUrl,
      discord_webhook_url: discordUrl,
      enable_turnstile: enableTurnstile,
      turnstile_secret_key: !enableTurnstile ? null : keepStoredSecret ? undefined : rawSecret,
    },
  };
}
