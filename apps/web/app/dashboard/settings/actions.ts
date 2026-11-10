'use server';

import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/types';
import { errorMessage, log } from '@/lib/log';

/**
 * Permanently deletes the signed-in user's account. Deleting the auth user cascades to the
 * profile, forms and submissions (ON DELETE CASCADE), so nothing personal is left behind in our database.
 *
 * Guards:
 *  - the user must type their own email address (checked here, not just in the browser);
 *  - an active or on-hold subscription must be cancelled first, so nobody keeps being billed
 *    for an account that no longer exists.
 */
export async function deleteAccountAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const typed = formData.get('confirm');
  if (typeof typed !== 'string' || !user.email || typed.trim().toLowerCase() !== user.email.toLowerCase()) {
    return { ok: false, message: 'Type your account email address exactly to confirm.' };
  }

  const { data: profile, error } = await supabase.from('profiles').select('billing_subscription_id').eq('id', user.id).maybeSingle();
  if (error || !profile) return { ok: false, message: 'We could not check your subscription. Please try again.' };
  if ((profile as { billing_subscription_id: string | null }).billing_subscription_id !== null) {
    return {
      ok: false,
      message: 'You still have a subscription. Open "Manage Subscription & Invoices", cancel it, wait for the plan to show Free, then delete your account.',
    };
  }

  try {
    const { error: deleteError } = await createAdminClient().auth.admin.deleteUser(user.id);
    if (deleteError) throw new Error(deleteError.message);
  } catch (err) {
    log('error', 'account deletion failed', { userId: user.id, error: errorMessage(err) });
    return { ok: false, message: 'We could not delete your account. Please try again, or contact support.' };
  }

  log('info', 'account deleted', { userId: user.id });
  await supabase.auth.signOut().catch(() => undefined); // the session is already invalid; this just clears cookies
  redirect('/auth/login');
}
