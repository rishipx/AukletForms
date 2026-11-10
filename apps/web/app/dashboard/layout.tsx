import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Brand } from '@/components/shared/brand';
import { UsageMeter } from '@/components/billing/usage-meter';
import { Button } from '@/components/ui/button';
import { PLAN_LIMITS } from '@/lib/billing/plans';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { signOutAction } from './actions';

/** Shown if the profile row cannot be read, so the header still renders. */
function fallbackProfile(): Profile {
  return {
    plan_tier: 'free',
    monthly_submission_limit: PLAN_LIMITS.free,
    current_cycle_usage: 0,
    cycle_resets_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  };
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data } = await supabase
    .from('profiles')
    .select('plan_tier,monthly_submission_limit,current_cycle_usage,cycle_resets_at')
    .eq('id', user.id)
    .maybeSingle();
  const profile = (data as Profile | null) ?? fallbackProfile();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/dashboard" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Brand />
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard/settings"
              className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Billing and plan"
            >
              <UsageMeter profile={profile} />
            </Link>
            <Link href="/dashboard/settings" className="hidden text-sm text-muted-foreground hover:text-foreground sm:block">
              Billing
            </Link>
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground md:block" title={user.email ?? undefined}>
              {user.email}
            </span>
            <form action={signOutAction}>
              <Button type="submit" variant="ghost" size="sm">
                <LogOut /> <span className="hidden sm:inline">Sign out</span>
                <span className="sr-only sm:hidden">Sign out</span>
              </Button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
