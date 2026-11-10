import { Badge } from '@/components/ui/badge';
import type { Profile } from '@/lib/types';
import { effectiveUsage } from '@/lib/billing/usage';
import { cn } from '@/lib/utils';

export function UsageMeter({ profile }: { profile: Profile }) {
  const used = effectiveUsage(profile);
  const limit = profile.monthly_submission_limit;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100;
  const hot = pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-warning' : 'bg-success';

  return (
    <div className="flex items-center gap-3">
      <Badge variant="accent" className="capitalize">
        {profile.plan_tier}
      </Badge>
      <div className="hidden min-w-36 flex-col gap-1 sm:flex" title={`Resets ${new Date(profile.cycle_resets_at).toUTCString()}`}>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Submissions</span>
          <span className="tabular-nums">
            {used.toLocaleString('en-US')} / {limit.toLocaleString('en-US')}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={used}
          aria-label="Submissions used this cycle"
        >
          <div className={cn('h-full rounded-full transition-all', hot)} style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
