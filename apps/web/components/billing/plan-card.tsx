import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PLAN_LABELS, PLAN_LIMITS, RETENTION_DAYS } from '@/lib/billing/plans';
import type { PlanTier } from '@/lib/types';

const PLAN_FEATURES: Record<PlanTier, string[]> = {
  free: [
    'Unlimited forms',
    'Email, Slack & Discord notifications',
    'Honeypot, link-spam filter & Turnstile',
    `${RETENTION_DAYS.free} days of submission history`,
  ],
  pro: ['Everything in Free', `${RETENTION_DAYS.pro} days of submission history`, 'More submissions every month'],
  agency: ['Everything in Pro', `${RETENTION_DAYS.agency} days of submission history`, 'Built for many client sites'],
};

export function PlanCard({ tier, current, upgrade }: { tier: PlanTier; current: boolean; upgrade: ReactNode }) {
  return (
    <Card className={current ? 'border-ring' : undefined}>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-lg">{PLAN_LABELS[tier]}</CardTitle>
          {current ? <Badge variant="accent">Current plan</Badge> : null}
        </div>
        <CardDescription>
          <span className="text-2xl font-semibold tabular-nums text-foreground">{PLAN_LIMITS[tier].toLocaleString('en-US')}</span> submissions / month
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2 text-sm">
          {PLAN_FEATURES[tier].map((feature) => (
            <li key={feature} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" /> {feature}
            </li>
          ))}
        </ul>
        {upgrade}
      </CardContent>
    </Card>
  );
}
