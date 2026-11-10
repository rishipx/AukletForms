import { log, errorMessage } from './log';
import { fetchForm, isFormConfig } from './supabase';
import type { Env, FormConfig } from './types';
import { isRecord } from './types';

/**
 * Form configuration is read-mostly and needed on every request (allowed
 * domains for CORS, Turnstile settings, notification targets), so it is cached
 * in Workers KV. Quota is deliberately NOT cached: it is checked live through
 * the atomic consume_submission_quota RPC.
 *
 * A short-lived in-memory layer sits in front of KV. A warm isolate answers repeat
 * requests without any KV read, which matters because the free plan allows only
 * 100,000 KV reads a day. (The Cache API would be the natural choice, but it only
 * works on custom domains, not on *.workers.dev.)
 *
 * Trade-off: dashboard edits take up to FORM_CACHE_TTL_SECONDS (default 60, KV's
 * minimum) plus MEMORY_TTL_MS to reach every isolate. "Form not found" is cached
 * too, so random UUID probing cannot hammer the database.
 */

type CachedForm = { found: true; form: FormConfig } | { found: false };

const DEFAULT_TTL_SECONDS = 60;
const MIN_TTL_SECONDS = 60; // Workers KV rejects a smaller expirationTtl
const MEMORY_TTL_MS = 30_000;
const MEMORY_MAX_ENTRIES = 500;

const memory = new Map<string, { expiresAt: number; entry: CachedForm }>();

/** Test hook: isolates keep module state between requests, so tests reset it explicitly. */
export function clearMemoryCache(): void {
  memory.clear();
}

function remember(key: string, entry: CachedForm): void {
  if (memory.size >= MEMORY_MAX_ENTRIES) {
    const oldest = memory.keys().next();
    if (!oldest.done) memory.delete(oldest.value);
  }
  memory.set(key, { expiresAt: Date.now() + MEMORY_TTL_MS, entry });
}

export function cacheKey(formId: string): string {
  return `form:${formId}`;
}

function ttlSeconds(env: Env): number {
  const parsed = Number.parseInt(env.FORM_CACHE_TTL_SECONDS ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(MIN_TTL_SECONDS, parsed) : DEFAULT_TTL_SECONDS;
}

function parseCached(value: unknown): CachedForm | null {
  if (!isRecord(value)) return null;
  if (value['found'] === false) return { found: false };
  if (value['found'] === true && isFormConfig(value['form'])) return { found: true, form: value['form'] };
  return null;
}

/** Cache first, Supabase on a miss. Returns null if the form does not exist. */
export async function loadFormConfig(env: Env, ctx: ExecutionContext, formId: string): Promise<FormConfig | null> {
  const key = cacheKey(formId);

  const hot = memory.get(key);
  if (hot !== undefined) {
    if (hot.expiresAt > Date.now()) return hot.entry.found ? hot.entry.form : null;
    memory.delete(key);
  }

  try {
    const cached = parseCached(await env.FORM_CACHE.get(key, 'json'));
    if (cached !== null) {
      remember(key, cached);
      return cached.found ? cached.form : null;
    }
  } catch (err) {
    // A KV outage must not take ingestion down; fall through to the database.
    log('warn', 'form cache read failed', { formId, error: errorMessage(err) });
  }

  const form = await fetchForm(env, formId);
  const entry: CachedForm = form === null ? { found: false } : { found: true, form };
  remember(key, entry);
  ctx.waitUntil(
    env.FORM_CACHE.put(key, JSON.stringify(entry), { expirationTtl: ttlSeconds(env) }).catch((err: unknown) => {
      log('warn', 'form cache write failed', { formId, error: errorMessage(err) });
    }),
  );
  return form;
}
