import { describe, expect, it } from 'vitest';
import { buildCsv, csvCell } from '@/lib/submissions/csv';
import type { SubmissionRecord } from '@/lib/types';

describe('CSV export', () => {
  const row = (payload: Record<string, unknown>, extra: Partial<SubmissionRecord> = {}): SubmissionRecord => ({
    id: 'id-1',
    form_id: 'f',
    payload,
    submitter_ip: '203.0.113.7',
    user_agent: 'UA, "quoted"',
    is_spam: false,
    notify_status: null,
    created_at: '2026-10-23T12:00:00.000Z',
    ...extra,
  });

  it('neutralizes spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('plain')).toBe('plain');
  });

  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('builds one column per payload key across all rows', () => {
    const csv = buildCsv([row({ name: 'Ada', tags: ['a', 'b'] }), row({ name: 'Bob', extra: { k: 1 } }, { id: 'id-2' })]);
    const lines = csv.trimEnd().split('\r\n');
    expect(lines[0]).toBe('id,created_at,is_spam,notify_status,submitter_ip,user_agent,name,tags,extra');
    expect(lines[1]).toBe('id-1,2026-10-23T12:00:00.000Z,false,,203.0.113.7,"UA, ""quoted""",Ada,"a, b",');
    expect(lines[2]).toBe('id-2,2026-10-23T12:00:00.000Z,false,,203.0.113.7,"UA, ""quoted""",Bob,,"{""k"":1}"');
  });
});
