/** Hand-written row types mirroring the database schema in supabase/migrations. */

export type PlanTier = 'free' | 'pro' | 'agency';

/** What happened to a submission's notification email. Mirrors submissions.notify_status. */
export type NotifyStatus = 'pending' | 'sent' | 'failed' | 'skipped_cap' | 'skipped_spam';

export interface Profile {
  plan_tier: PlanTier;
  monthly_submission_limit: number;
  current_cycle_usage: number;
  cycle_resets_at: string;
}

export interface FormRecord {
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
  created_at: string;
  updated_at: string;
}

/** A form as the browser sees it: the stored Turnstile secret never leaves the server, only whether one exists. */
export type PublicForm = Omit<FormRecord, 'turnstile_secret_key'> & { has_turnstile_secret: boolean };

export interface FormListItem extends Pick<FormRecord, 'id' | 'name' | 'target_email' | 'allowed_domains' | 'enable_turnstile' | 'created_at'> {
  submissions: Array<{ count: number }>;
}

export interface SubmissionRecord {
  id: string;
  form_id: string;
  payload: Record<string, unknown>;
  submitter_ip: string | null;
  user_agent: string | null;
  is_spam: boolean;
  notify_status: NotifyStatus | null;
  created_at: string;
}

export const SUBMISSION_COLUMNS = 'id,form_id,payload,submitter_ip,user_agent,is_spam,notify_status,created_at';

export type FieldName = 'name' | 'target_email' | 'allowed_domains' | 'redirect_url' | 'slack_webhook_url' | 'discord_webhook_url' | 'turnstile_secret_key';

export type FieldErrors = Partial<Record<FieldName, string>>;

export interface ActionState {
  ok: boolean;
  message?: string;
  errors?: FieldErrors;
}
