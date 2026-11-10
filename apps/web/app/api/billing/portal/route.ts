import DodoPayments from 'dodopayments';
import { ApiProblem, apiProblems, assertSameOrigin, problemJson, siteOrigin } from '@/lib/http/api';
import { BillingConfigError, getDodo } from '@/lib/billing/dodo';
import { errorMessage, log } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Opens the Dodo Payments customer portal, where users update payment methods, change plans,
 * download invoices and cancel. We deliberately build none of that ourselves.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw apiProblems.unauthorized();

    const { data: profile, error } = await supabase.from('profiles').select('billing_customer_id').eq('id', user.id).maybeSingle();
    if (error || !profile) throw apiProblems.internal();
    const customerId = (profile as { billing_customer_id: string | null }).billing_customer_id;
    if (customerId === null) throw apiProblems.noBillingAccount();

    const session = await getDodo().customers.customerPortal.create(customerId, {
      return_url: `${siteOrigin(request)}/dashboard/settings`,
    });

    return Response.json({ url: session.link }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    if (err instanceof ApiProblem) return problemJson(err);
    if (err instanceof BillingConfigError) {
      log('error', 'billing misconfigured', { error: err.message });
      return problemJson(apiProblems.billingNotConfigured());
    }
    if (err instanceof DodoPayments.APIError) {
      log('error', 'dodo portal session failed', { status: err.status, error: err.message });
      return problemJson(apiProblems.providerError());
    }
    log('error', 'portal route failed', { error: errorMessage(err) });
    return problemJson(apiProblems.internal());
  }
}
