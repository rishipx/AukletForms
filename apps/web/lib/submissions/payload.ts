export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stringifyValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1))}…`;
}

/** The first few non-empty fields, for the "Key Fields" column of the submissions table. */
export function summarizePayload(payload: Record<string, unknown>, maxFields = 3, maxValueLength = 70): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const [key, raw] of Object.entries(payload)) {
    const value = stringifyValue(raw).replace(/\s+/g, ' ').trim();
    if (value === '') continue;
    out.push({ key, value: truncate(value, maxValueLength) });
    if (out.length === maxFields) break;
  }
  return out;
}
