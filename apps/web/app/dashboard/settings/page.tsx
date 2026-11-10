import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { BillingButton } from '@/components/billing/billing-button';
import { DeleteAccount } from '@/components/account/delete-account';
import { PlanCard } from '@/components/billing/plan-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAN_LABELS, productMapFromEnv, type PaidPlan } from '@/lib/billing/plans';
import { createClient } from '@/lib/supabase/server';
import type { PlanTier } from '@/lib/types';
import { effectiveUsage } from '@/lib/billing/usage';
import { formatDateUtc } from '@/lib/utils';

export const metadata: Metadata = { title: 'Billing' };

interface BillingProfile {
  email: string;
  plan_tier: PlanTier;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  monthly_submission_limit: number;
  current_cycle_usage: number;
  cycle_resets_at: string;
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login?next=/dashboard/settings');

  const { data } = await supabase
    .from('profiles')
    .select('email,plan_tier,billing_customer_id,billing_subscription_id,monthly_submission_limit,current_cycle_usage,cycle_resets_at')
    .eq('id', user.id)
    .maybeSingle();
  if (!data) throw new Error('Could not load your account.');
  const profile = data as BillingProfile;

  const products = productMapFromEnv();
  const used = effectiveUsage(profile);
  const hasSubscription = profile.billing_subscription_id !== null;
  const canManage = profile.billing_customer_id !== null;

  function upgradeControl(tier: PaidPlan): ReactNode {
    if (profile.plan_tier === tier) return null;
    if (hasSubscription) return <p className="text-sm text-muted-foreground">Switch plans from Manage Subscription below.</p>;
    if (products[tier] === undefined) return <p className="text-sm text-muted-foreground">Not available on this deployment.</p>;
    return <BillingButton endpoint="/api/billing/checkout" body={{ plan: tier }} label={`Upgrade to ${PLAN_LABELS[tier]}`} />;
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> All forms
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted-foreground">{profile.email}</p>
        </div>
      </div>

      {checkout === 'success' ? (
        <p role="status" className="rounded-lg border border-success/40 bg-success/10 p-4 text-sm">
          Thanks! Your payment went through. Your new plan is applied within a few seconds. Refresh this page if it still shows the old one.
        </p>
      ) : null}
      {checkout === 'cancelled' ? (
        <p role="status" className="rounded-lg border bg-muted/50 p-4 text-sm">
          Checkout was cancelled. You have not been charged.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Usage this cycle <Badge variant="accent">{PLAN_LABELS[profile.plan_tier]}</Badge>
          </CardTitle>
          <CardDescription>
            <span className="font-semibold tabular-nums text-foreground">{used.toLocaleString('en-US')}</span> of{' '}
            <span className="tabular-nums">{profile.monthly_submission_limit.toLocaleString('en-US')}</span> submissions used. Resets{' '}
            {formatDateUtc(profile.cycle_resets_at)}.
          </CardDescription>
        </CardHeader>
        {canManage ? (
          <CardContent className="flex flex-col gap-3">
            <BillingButton endpoint="/api/billing/portal" label="Manage Subscription & Invoices" variant="outline" className="self-start" />
            <p className="text-xs text-muted-foreground">Update your card, change plan, download invoices or cancel, all on Dodo Payments&apos; secure page.</p>
          </CardContent>
        ) : null}
      </Card>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold tracking-tight">Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <PlanCard tier="free" current={profile.plan_tier === 'free'} upgrade={null} />
          <PlanCard tier="pro" current={profile.plan_tier === 'pro'} upgrade={upgradeControl('pro')} />
          <PlanCard tier="agency" current={profile.plan_tier === 'agency'} upgrade={upgradeControl('agency')} />
        </div>
        <p className="text-xs text-muted-foreground">
          Older submissions are deleted automatically after the history period of your plan. Download a CSV from a form first if you need to keep them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold tracking-tight text-destructive">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Permanently deletes your account, forms and every stored submission. This cannot be undone. Cancel any subscription first.
        </p>
        <DeleteAccount email={profile.email} />
      </section>
    </div>
  );
}
