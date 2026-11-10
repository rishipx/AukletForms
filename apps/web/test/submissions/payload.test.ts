import { describe, expect, it } from 'vitest';
import { summarizePayload } from '@/lib/submissions/payload';

describe('payload summary', () => {
  it('shows the first non-empty fields and truncates long values', () => {
    const s = summarizePayload({ skip: '', name: 'Ada', email: 'ada@example.com', message: 'x'.repeat(200), extra: 'nope' });
    expect(s.map((f) => f.key)).toEqual(['name', 'email', 'message']);
    expect(s[2]?.value.length).toBe(70);
    expect(s[2]?.value.endsWith('…')).toBe(true);
  });
});
