export interface Env {
  /** KV namespace caching per-form configuration. */
  FORM_CACHE: KVNamespace;
  /** e.g. https://abcdefgh.supabase.co */
  SUPABASE_URL: string;
  /** Secret. Service-role (legacy JWT) or `sb_secret_...` key. Bypasses RLS. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Secret. Resend API key. */
  RESEND_API_KEY: string;
  /** Verified Resend sender, e.g. "Auklet Forms <forms@notify.auklet.dev>". */
  EMAIL_FROM: string;
  /** Optional absolute URL used instead of the built-in /thanks page. */
  THANK_YOU_URL?: string;
  /** Optional KV cache TTL in seconds (minimum 60). */
  FORM_CACHE_TTL_SECONDS?: string;
  /** Optional rate-limiting binding (see wrangler.toml). Used per client IP and form when present. */
  RATE_LIMITER?: RateLimit;
  /** Secret. Base64 of 32 bytes. Required once any form stores an encrypted Turnstile key. */
  TURNSTILE_ENC_KEY?: string;
  /** Optional. Notification emails allowed per UTC day across all forms (default 90, under Resend's free 100). */
  EMAIL_DAILY_GLOBAL_CAP?: string;
  /** Optional. Notification emails allowed per UTC day for a single form (default 25). */
  EMAIL_DAILY_FORM_CAP?: string;
}

/** What happened to a submission's notification email. Mirrors submissions.notify_status. */
export type NotifyStatus = 'pending' | 'sent' | 'failed' | 'skipped_cap' | 'skipped_spam';

/** The subset of public.forms the Worker needs. */
export interface FormConfig {
  id: string;
  user_id: string;
  name: string;
  target_email: string;
  allowed_domains: string[];
  redirect_url: string | null;
  slack_webhook_url: string | null;
  discord_webhook_url: string | null;
  enable_turnstile: boolean;
  turnstile_secret_key: string | null;
}

/** A parsed submission body: field name -> string | string[] | file descriptor | JSON value. */
export type Payload = Record<string, unknown>;

/** A row for public.submissions. */
export interface SubmissionRow {
  id: string;
  form_id: string;
  payload: Payload;
  submitter_ip: string | null;
  user_agent: string | null;
  is_spam: boolean;
  notify_status: NotifyStatus;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
