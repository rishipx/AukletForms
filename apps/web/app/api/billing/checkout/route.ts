import DodoPayments from 'dodopayments';
import { ApiProblem, apiProblems, assertSameOrigin, problemJson, siteOrigin } from '@/lib/http/api';
import { BillingConfigError, getDodo } from '@/lib/billing/dodo';
import { isPaidPlan, productForPlan, productMapFromEnv } from '@/lib/billing/plans';
import { errorMessage, log } from '@/lib/log';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starts a Dodo Payments checkout session for the chosen plan and returns its URL. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);

    const body: unknown = await request.json().catch(() => null);
    const plan = typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['plan'] : undefined;
    if (!isPaidPlan(plan)) throw apiProblems.invalidRequest('Choose the "pro" or "agency" plan.');

    const productId = productForPlan(plan, productMapFromEnv());
    if (productId === null) throw apiProblems.billingNotConfigured();

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw apiProblems.unauthorized();

    const { data: profile, error } = await supabase.from('profiles').select('billing_customer_id,billing_subscription_id').eq('id', user.id).maybeSingle();
    if (error || !profile) throw apiProblems.internal();
    const { billing_customer_id: customerId, billing_subscription_id: subscriptionId } = profile as {
      billing_customer_id: string | null;
      billing_subscription_id: string | null;
    };

    // A second subscription would double-bill. Plan changes happen in the customer portal.
    if (subscriptionId !== null) throw apiProblems.alreadySubscribed();

    // Returning customers reuse their Dodo customer; first-timers are created from their (verified) login email.
    let customer: { customer_id: string } | { email: string };
    if (customerId !== null) customer = { customer_id: customerId };
    else if (user.email) customer = { email: user.email };
    else throw apiProblems.invalidRequest('Your account has no email address, which checkout requires.');

    const site = siteOrigin(request);
    const session = await getDodo().checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer,
      // The webhook links the Dodo customer to this user through the metadata, with email as fallback.
      metadata: { user_id: user.id, plan },
      return_url: `${site}/dashboard/settings?checkout=success`,
      cancel_url: `${site}/dashboard/settings?checkout=cancelled`,
    });

    if (!session.checkout_url) throw apiProblems.providerError();
    return Response.json({ url: session.checkout_url }, { headers: { 'cache-control': 'no-store' } });
  } catch (err) {
    return toProblem(err);
  }
}

function toProblem(err: unknown): Response {
  if (err instanceof ApiProblem) return problemJson(err);
  if (err instanceof BillingConfigError) {
    log('error', 'billing misconfigured', { error: err.message });
    return problemJson(apiProblems.billingNotConfigured());
  }
  if (err instanceof DodoPayments.APIError) {
    log('error', 'dodo checkout failed', { status: err.status, error: err.message });
    return problemJson(apiProblems.providerError());
  }
  log('error', 'checkout route failed', { error: errorMessage(err) });
  return problemJson(apiProblems.internal());
}
