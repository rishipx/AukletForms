import { afterEach, beforeEach, vi } from 'vitest';
import { clearMemoryCache } from '../src/config';
import { handleRequest } from '../src/handler';
import type { Env, FormConfig } from '../src/types';

export const SUPABASE = 'https://proj.supabase.co';
export const FORM_ID = '11111111-1111-4111-8111-111111111111';
export const USER_ID = '22222222-2222-4222-8222-222222222222';
export const ENDPOINT = `https://api.test/v1/f/${FORM_ID}`;

export const baseForm: FormConfig = {
  id: FORM_ID,
  user_id: USER_ID,
  name: 'Contact',
  target_email: 'owner@example.com',
  allowed_domains: ['example.com'],
  redirect_url: 'https://example.com/thanks',
  slack_webhook_url: 'https://hooks.slack.com/services/T000/B000/xxxx',
  discord_webhook_url: null,
  enable_turnstile: false,
  turnstile_secret_key: null,
};

export interface Upstream {
  form: FormConfig | null;
  quotaOk: boolean;
  /** Verdict of consume_email_slot, or 'error' to simulate the RPC failing. */
  emailBudget: 'ok' | 'form_cap' | 'global_cap' | 'error';
  turnstileSuccess: boolean;
  calls: Array<{ url: string; method: string; body: string | null; headers: Record<string, string> }>;
}

/** Fake upstream services and KV, rebuilt before every test by `installHarness()`. */
export let upstream: Upstream;
export let kv: Map<string, string>;
let pending: Promise<unknown>[];

export function makeEnv(): Env {
  const kvStub = {
    get: async (key: string, type?: string) => {
      const v = kv.get(key);
      return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      kv.set(key, value);
    },
  };
  return {
    FORM_CACHE: kvStub as unknown as KVNamespace,
    SUPABASE_URL: SUPABASE,
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    RESEND_API_KEY: 're_test',
    EMAIL_FROM: 'Auklet <forms@notify.auklet.dev>',
  };
}

function makeCtx(): ExecutionContext {
  return {
    waitUntil: (p: Promise<unknown>) => {
      pending.push(p);
    },
    passThroughOnException: () => undefined,
    props: {},
  } as unknown as ExecutionContext;
}

export async function send(request: Request, env: Env = makeEnv()): Promise<Response> {
  const res = await handleRequest(request, env, makeCtx());
  await Promise.all(pending); // let background work finish, like waitUntil would
  return res;
}

/** Rows POSTed to /submissions (the PATCH that records the email outcome is separate). */
export function inserts() {
  return upstream.calls.filter((c) => c.url.includes('/rest/v1/submissions') && c.method === 'POST');
}
export function statusPatches() {
  return upstream.calls
    .filter((c) => c.url.includes('/rest/v1/submissions') && c.method === 'PATCH')
    .map((c) => JSON.parse(c.body ?? '{}') as { notify_status: string });
}
export function insertedRow() {
  return JSON.parse(inserts()[0]?.body ?? '{}') as Record<string, unknown>;
}

export function callsTo(fragment: string) {
  return upstream.calls.filter((c) => c.url.includes(fragment));
}

/** Call once at the top of a test file: registers the setup and teardown hooks. */
export function installHarness(): void {
  beforeEach(() => {
    upstream = { form: baseForm, quotaOk: true, emailBudget: 'ok', turnstileSuccess: true, calls: [] };
    clearMemoryCache();
    kv = new Map();
    pending = [];
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const body = init?.body === undefined || init.body === null ? null : String(init.body);
        upstream.calls.push({ url, method: init?.method ?? 'GET', body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });

        if (url.startsWith(`${SUPABASE}/rest/v1/forms`)) {
          return Response.json(upstream.form === null ? [] : [upstream.form]);
        }
        if (url.startsWith(`${SUPABASE}/rest/v1/rpc/consume_submission_quota`)) {
          return Response.json(upstream.quotaOk);
        }
        if (url.startsWith(`${SUPABASE}/rest/v1/rpc/consume_email_slot`)) {
          return upstream.emailBudget === 'error' ? new Response('boom', { status: 500 }) : Response.json(upstream.emailBudget);
        }
        if (url.startsWith(`${SUPABASE}/rest/v1/submissions`)) {
          return new Response(null, { status: 201 });
        }
        if (url.startsWith('https://challenges.cloudflare.com/')) {
          return Response.json(upstream.turnstileSuccess ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });
        }
        if (url.startsWith('https://api.resend.com/')) return Response.json({ id: 'email_1' });
        if (url.startsWith('https://hooks.slack.com/')) return new Response('ok');
        throw new Error(`unexpected fetch: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}

export const jsonPost = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', origin: 'https://example.com', ...headers },
    body: JSON.stringify(body),
  });
