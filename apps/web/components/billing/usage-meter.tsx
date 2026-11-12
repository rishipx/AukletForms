import Link from 'next/link';
import type { Profile } from '@/lib/types';
import { effectiveUsage } from '@/lib/billing/usage';
import { cn, formatDateUtc } from '@/lib/utils';

export function UsageMeter({ profile }: { profile: Profile }) {
  const used = effectiveUsage(profile);
  const limit = profile.monthly_submission_limit;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const hot = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-primary';

  return (
    <Link href="/dashboard/settings" aria-label="Usage and plan" className="flex flex-col gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium capitalize">{profile.plan_tier} plan</span>
        <span className="text-xs text-muted-foreground tabular-nums">{pct}%</span>
      </div>
      <div
        className="h-1 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
        aria-label="Submissions used this cycle"
      >
        <div className={cn('h-full rounded-full transition-all', hot)} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums">
          {used.toLocaleString('en-US')} of {limit.toLocaleString('en-US')}
        </span>{' '}
        submissions · resets {formatDateUtc(profile.cycle_resets_at)}
      </p>
    </Link>
  );
}
