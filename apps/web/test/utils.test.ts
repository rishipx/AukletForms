import { describe, expect, it } from 'vitest';
import { safeNextPath } from '@/lib/utils';

describe('safeNextPath', () => {
  it('allows same-site paths and blocks open redirects', () => {
    expect(safeNextPath('/dashboard/forms/abc?tab=settings')).toBe('/dashboard/forms/abc?tab=settings');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'dashboard', '', null, undefined]) {
      expect(safeNextPath(bad as string | null | undefined), String(bad)).toBe('/dashboard');
    }
  });
});
