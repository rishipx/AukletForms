import Link from 'next/link';
import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Brand } from '@/components/shared/brand';
import { UsageMeter } from '@/components/billing/usage-meter';
import { AppNav } from '@/components/shared/app-nav';
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

  const signOut = (
    <form action={signOutAction}>
      <Button type="submit" variant="ghost" size="sm" className="justify-start text-muted-foreground">
        <LogOut /> <span className="hidden lg:inline">Sign out</span>
        <span className="sr-only lg:hidden">Sign out</span>
      </Button>
    </form>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="hidden border-r bg-sidebar lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col lg:gap-6 lg:px-3 lg:py-4">
        <Link href="/dashboard" className="w-fit rounded-md px-2.5 py-1">
          <Brand />
        </Link>
        <AppNav />
        <div className="mt-auto flex flex-col gap-3">
          <UsageMeter profile={profile} />
          <div className="flex flex-col gap-1 border-t pt-3">
            <span className="truncate px-2.5 text-xs text-muted-foreground" title={user.email ?? undefined}>
              {user.email}
            </span>
            {signOut}
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b bg-background/90 px-4 backdrop-blur lg:hidden">
          <Link href="/dashboard" className="rounded-md">
            <Brand />
          </Link>
          <div className="flex items-center gap-1">
            <AppNav orientation="horizontal" />
            {signOut}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  );
}
