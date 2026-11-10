import { describe, expect, it } from 'vitest';
import { notifyBadge } from '@/lib/submissions/notify';

describe('email outcome badges', () => {
  it('flags only outcomes that need attention', () => {
    expect(notifyBadge('skipped_cap')?.label).toBe('Email skipped');
    expect(notifyBadge('failed')).toMatchObject({ label: 'Email failed', variant: 'destructive' });
    for (const quiet of ['sent', 'pending', 'skipped_spam', null] as const) expect(notifyBadge(quiet)).toBeNull();
  });
});
