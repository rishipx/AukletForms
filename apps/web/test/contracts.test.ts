import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAN_LIMITS, RETENTION_DAYS } from '@/lib/billing/plans';

const REPO_ROOT = join(__dirname, '..', '..', '..');

// The repository holds a few deliberate copies (numbers in SQL and TypeScript, and the secrets module in
// both apps). These tests fail if the copies drift apart.
describe('app and database stay in sync', () => {
  const dir = join(REPO_ROOT, 'supabase', 'migrations');
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');

  it('free plan limit matches the profiles column default', () => {
    expect(sql).toMatch(new RegExp(`monthly_submission_limit INT NOT NULL DEFAULT ${PLAN_LIMITS.free}\\b`));
  });

  it('retention days match purge_old_data()', () => {
    expect(sql).toContain(`WHEN 'free' THEN INTERVAL '${RETENTION_DAYS.free} days'`);
    expect(sql).toContain(`WHEN 'pro'  THEN INTERVAL '${RETENTION_DAYS.pro} days'`);
    expect(sql).toContain(`ELSE             INTERVAL '${RETENTION_DAYS.agency} days'`);
  });
});

describe('shared source copies stay identical', () => {
  // Everything after the header comment must match byte for byte.
  const body = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\n/, '');

  it('secrets.ts is the same in the dashboard and the Worker', () => {
    expect(body('apps/web/lib/security/secrets.ts')).toBe(body('apps/worker/src/secrets.ts'));
  });
});
