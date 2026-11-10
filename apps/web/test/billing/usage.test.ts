import { describe, expect, it } from 'vitest';
import { effectiveUsage } from '@/lib/billing/usage';

describe('effective usage', () => {
  const profile = { plan_tier: 'free' as const, monthly_submission_limit: 250, current_cycle_usage: 240, cycle_resets_at: '2026-11-01T00:00:00.000Z' };
  it('shows stored usage inside the cycle and zero after it has expired', () => {
    expect(effectiveUsage(profile, new Date('2026-10-23T00:00:00Z'))).toBe(240);
    expect(effectiveUsage(profile, new Date('2026-11-02T00:00:00Z'))).toBe(0);
  });
});
