import type { Payload } from './types';

/** Hidden fields real users never fill in. Any populated value marks the submission as a bot. */
const HONEYPOT_FIELDS: ReadonlySet<string> = new Set(['_gotcha', '_botcheck', '_honeypot']);
const TURNSTILE_FIELD = 'cf-turnstile-response';

export interface ControlFields {
  /** Payload with honeypot and Turnstile fields removed; this is what gets stored and relayed. */
  cleaned: Payload;
  honeypotTripped: boolean;
  turnstileToken: string | null;
}

export function isPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.some(isPopulated);
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true; // numbers and anything else count as populated
}

export function extractControlFields(payload: Payload): ControlFields {
  const kept: Array<[string, unknown]> = [];
  let honeypotTripped = false;
  let turnstileToken: string | null = null;

  for (const [key, value] of Object.entries(payload)) {
    if (HONEYPOT_FIELDS.has(key)) {
      if (isPopulated(value)) honeypotTripped = true;
      continue;
    }
    if (key === TURNSTILE_FIELD) {
      const first = Array.isArray(value) ? value[0] : value;
      turnstileToken = typeof first === 'string' ? first : null;
      continue;
    }
    kept.push([key, value]);
  }

  return { cleaned: Object.fromEntries(kept), honeypotTripped, turnstileToken };
}

/** A message with this many links or more is flagged as spam (stored and visible, but never emailed). */
export const SPAM_LINK_THRESHOLD = 4;
const LINK_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const MAX_SCAN_DEPTH = 4;

function countLinks(value: unknown, depth: number): number {
  if (typeof value === 'string') return value.match(LINK_RE)?.length ?? 0;
  if (depth >= MAX_SCAN_DEPTH) return 0;
  if (Array.isArray(value)) return value.reduce<number>((n, v) => n + countLinks(v, depth + 1), 0);
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).reduce<number>((n, v) => n + countLinks(v, depth + 1), 0);
  }
  return 0;
}

/**
 * Deliberately conservative: link stuffing is the most common form-spam pattern and
 * almost never appears in a real enquiry. Flagged submissions are still stored so the
 * owner can read them in the dashboard; they just do not use up the email budget.
 */
export function looksLikeSpam(payload: Payload): boolean {
  return countLinks(payload, 0) >= SPAM_LINK_THRESHOLD;
}
