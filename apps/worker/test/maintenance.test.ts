import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import type { Env } from '../src/types';

const env = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' } as unknown as Env;

function ctxCollector() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    ctx: { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => undefined, props: {} } as unknown as ExecutionContext,
  };
}

describe('scheduled maintenance', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('calls purge_old_data with the service key', async () => {
    const fetchMock = vi.fn(async () => Response.json({ submissions: 3, billing_events: 1, email_counters: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    const { pending, ctx } = ctxCollector();
    worker.scheduled?.(
      { cron: '17 3 * * *', scheduledTime: Date.now(), type: 'scheduled', noRetry: () => undefined } as unknown as ScheduledController,
      env,
      ctx,
    );
    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://proj.supabase.co/rest/v1/rpc/purge_old_data');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['apikey']).toBe('sb_secret_x');
  });

  it('fails the run (so it shows up in the Cloudflare dashboard) when the database errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('down', { status: 503 }));
    const { pending, ctx } = ctxCollector();
    worker.scheduled?.({} as ScheduledController, env, ctx);
    await expect(Promise.all(pending)).rejects.toThrow(/purge_old_data failed/);
  });
});
