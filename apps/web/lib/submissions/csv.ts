import { stringifyValue } from '@/lib/submissions/payload';
import type { SubmissionRecord } from '@/lib/types';

/**
 * Cells starting with = + - @ (or tab/CR) are executed as formulas by Excel and
 * Sheets. Submitters control these values, so prefix them with an apostrophe
 * (OWASP "CSV injection" guidance). The cost: a legitimate "-5" opens as "'-5".
 */
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  let s = stringifyValue(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const FIXED_COLUMNS = ['id', 'created_at', 'is_spam', 'notify_status', 'submitter_ip', 'user_agent'] as const;

/** One column per distinct payload key, in first-seen order. */
export function buildCsv(rows: readonly SubmissionRecord[]): string {
  const payloadKeys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.payload)) {
      if (!seen.has(key)) {
        seen.add(key);
        payloadKeys.push(key);
      }
    }
  }

  const header = [...FIXED_COLUMNS, ...payloadKeys].map(csvCell).join(',');
  const lines = rows.map((row) =>
    [
      row.id,
      row.created_at,
      row.is_spam ? 'true' : 'false',
      row.notify_status ?? '',
      row.submitter_ip ?? '',
      row.user_agent ?? '',
      ...payloadKeys.map((key) => row.payload[key] ?? ''),
    ]
      .map(csvCell)
      .join(','),
  );
  return [header, ...lines].join('\r\n') + '\r\n';
}
