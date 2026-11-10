'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { log, errorMessage } from '@/lib/log';
import { encryptSecret } from '@/lib/security/secrets';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/types';
import { UUID_RE } from '@/lib/utils';
import { parseFormInput, type FormInput } from '@/lib/forms/validation';

const NO_ENCRYPTION_KEY =
  'Turnstile secrets are stored encrypted, and this server has no TURNSTILE_ENC_KEY set. Add one (openssl rand -base64 32) and try again.';

/** Encrypts a freshly entered Turnstile secret. Returns an error message if that is impossible. */
async function protectSecret(value: FormInput): Promise<string | null> {
  if (typeof value.turnstile_secret_key !== 'string') return null;
  const key = process.env['TURNSTILE_ENC_KEY'];
  if (!key) return NO_ENCRYPTION_KEY;
  try {
    value.turnstile_secret_key = await encryptSecret(value.turnstile_secret_key, key);
    return null;
  } catch (err) {
    log('error', 'secret encryption failed', { error: errorMessage(err) });
    return 'TURNSTILE_ENC_KEY is invalid. It must be base64 of 32 random bytes (openssl rand -base64 32).';
  }
}

export async function createFormAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFormInput(formData);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: 'Please fix the highlighted fields.' };
  const secretProblem = await protectSecret(parsed.value);
  if (secretProblem) return { ok: false, errors: { turnstile_secret_key: secretProblem }, message: secretProblem };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data, error } = await supabase
    .from('forms')
    .insert({ user_id: user.id, ...parsed.value })
    .select('id')
    .single();

  if (error || !data) {
    log('error', 'create form failed', { code: error?.code });
    return { ok: false, message: 'We could not create the form. Please try again.' };
  }

  revalidatePath('/dashboard');
  redirect(`/dashboard/forms/${(data as { id: string }).id}?tab=integration`);
}

export async function updateFormAction(formId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!UUID_RE.test(formId)) return { ok: false, message: 'Form not found.' };

  const supabase = await createClient();
  // Does this form already have a secret on file? Then a blank field means "keep it". RLS limits this read to the owner.
  const { data: existing } = await supabase.from('forms').select('turnstile_secret_key').eq('id', formId).maybeSingle();
  const hasStoredSecret = typeof (existing as { turnstile_secret_key: string | null } | null)?.turnstile_secret_key === 'string';

  const parsed = parseFormInput(formData, { hasStoredSecret });
  if (!parsed.ok) return { ok: false, errors: parsed.errors, message: 'Please fix the highlighted fields.' };
  const secretProblem = await protectSecret(parsed.value);
  if (secretProblem) return { ok: false, errors: { turnstile_secret_key: secretProblem }, message: secretProblem };

  // RLS limits this to the caller's own forms; zero rows back means "not yours" or "gone".
  const { data, error } = await supabase.from('forms').update(parsed.value).eq('id', formId).select('id');

  if (error) {
    log('error', 'update form failed', { code: error.code });
    return { ok: false, message: 'We could not save your changes. Please try again.' };
  }
  if (!data || data.length === 0) return { ok: false, message: 'Form not found.' };

  revalidatePath('/dashboard');
  revalidatePath(`/dashboard/forms/${formId}`);
  return { ok: true, message: 'Saved. Changes reach the edge network within about a minute.' };
}

export async function deleteFormAction(formId: string, _formData: FormData): Promise<void> {
  if (!UUID_RE.test(formId)) redirect('/dashboard');

  const supabase = await createClient();
  const { error } = await supabase.from('forms').delete().eq('id', formId);
  if (error) {
    log('error', 'delete form failed', { code: error.code });
    throw new Error('Could not delete the form.');
  }

  revalidatePath('/dashboard');
  redirect('/dashboard');
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/auth/login');
}
