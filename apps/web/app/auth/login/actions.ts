'use server';

import { headers } from 'next/headers';
import { SITE_URL } from '@/lib/config/env';
import { log } from '@/lib/log';
import { isValidEmail, safeNextPath } from '@/lib/utils';
import { createClient } from '@/lib/supabase/server';

export type LoginState = { status: 'idle' } | { status: 'sent'; email: string } | { status: 'error'; message: string };

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  if (!isValidEmail(email)) {
    return { status: 'error', message: 'Enter a valid email address.' };
  }

  const next = safeNextPath(String(formData.get('next') ?? ''));
  const requestOrigin = (await headers()).get('origin');
  const origin = SITE_URL !== '' ? SITE_URL : requestOrigin;
  if (!origin) {
    return { status: 'error', message: 'This deployment has no NEXT_PUBLIC_SITE_URL configured, so the sign-in link cannot be built.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });

  if (error) {
    log('error', 'magic link request failed', { status: error.status, code: error.code });
    if (error.status === 429) {
      return { status: 'error', message: 'Too many sign-in emails requested. Please wait a minute and try again.' };
    }
    return { status: 'error', message: 'We could not send the sign-in email. Please try again.' };
  }

  return { status: 'sent', email };
}
