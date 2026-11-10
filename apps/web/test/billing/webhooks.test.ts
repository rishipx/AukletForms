import { Webhook } from 'standardwebhooks';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  addOneMonthUtc,
  cycleEnd,
  parseSubscription,
  processDodoEvent,
  type BillingDeps,
  type BillingStore,
  type DodoEvent,
  type ProfilePatch,
  type ProfileRef,
} from '@/lib/billing/handlers';
import { PLAN_LIMITS, planForProduct, productForPlan } from '@/lib/billing/plans';
import { verifyWebhook } from '@/lib/billing/webhook';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-10-23T12:00:00.000Z');
const PRODUCTS = { pro: 'pdt_pro', agency: 'pdt_agency' };
const NEXT_BILLING = '2026-11-23T12:00:00.000Z';

interface FakeProfile extends ProfileRef {
  email: string;
  monthly_submission_limit: number;
  current_cycle_usage: number;
  cycle_resets_at: string;
}

function makeStore(profiles: FakeProfile[]) {
  const claimed = new Set<string>();
  const updates: Array<{ id: string; patch: ProfilePatch }> = [];
  const store: BillingStore = {
    async claimEvent(id) {
      if (claimed.has(id)) return false;
      claimed.add(id);
      return true;
    },
    async releaseEvent(id) {
      claimed.delete(id);
    },
    async findProfileById(id) {
      return profiles.find((p) => p.id === id) ?? null;
    },
    async findProfileByCustomerId(customerId) {
      return profiles.find((p) => p.billing_customer_id === customerId) ?? null;
    },
    async findProfileByEmail(email) {
      const hits = profiles.filter((p) => p.email.toLowerCase() === email.toLowerCase());
      return hits.length === 1 ? (hits[0] ?? null) : null;
    },
    async updateProfile(id, patch) {
      const profile = profiles.find((p) => p.id === id);
      if (!profile) throw new Error('missing profile');
      Object.assign(profile, patch);
      updates.push({ id, patch });
    },
  };
  return { store, claimed, updates };
}

const freeProfile = (over: Partial<FakeProfile> = {}): FakeProfile => ({
  id: USER_A,
  email: 'a@example.com',
  plan_tier: 'free',
  billing_customer_id: null,
  billing_subscription_id: null,
  billing_updated_at: null,
  monthly_submission_limit: 250,
  current_cycle_usage: 200,
  cycle_resets_at: '2026-11-01T00:00:00.000Z',
  ...over,
});

const proProfile = (over: Partial<FakeProfile> = {}): FakeProfile =>
  freeProfile({
    plan_tier: 'pro',
    monthly_submission_limit: 3000,
    billing_customer_id: 'cus_1',
    billing_subscription_id: 'sub_1',
    billing_updated_at: '2026-10-20T00:00:00.000Z',
    current_cycle_usage: 1234,
    ...over,
  });

interface SubOpts {
  subscription_id?: string;
  status?: string;
  product_id?: string;
  customer_id?: string;
  email?: string;
  user_id?: string | null;
  next_billing_date?: string;
  timestamp?: string;
}

/** Builds a webhook event shaped like Dodo's subscription payloads (`data` is the subscription object). */
function event(type: string, o: SubOpts = {}): DodoEvent {
  return {
    type,
    timestamp: o.timestamp ?? '2026-10-23T11:59:00.000Z',
    data: {
      subscription_id: o.subscription_id ?? 'sub_1',
      status: o.status ?? 'active',
      product_id: o.product_id ?? 'pdt_pro',
      customer: { customer_id: o.customer_id ?? 'cus_1', email: o.email ?? 'a@example.com', name: 'A' },
      metadata: o.user_id === null ? {} : { user_id: o.user_id ?? USER_A, plan: 'pro' },
      next_billing_date: o.next_billing_date ?? NEXT_BILLING,
    },
  };
}

let profiles: FakeProfile[];
let ctx: ReturnType<typeof makeStore>;
let deps: BillingDeps;
let seq: number;
const send = (e: DodoEvent, id?: string) => processDodoEvent(id ?? `msg_${++seq}`, e, deps);

beforeEach(() => {
  profiles = [freeProfile()];
  ctx = makeStore(profiles);
  seq = 0;
  deps = { store: ctx.store, planForProduct: (id) => planForProduct(id, PRODUCTS), now: () => NOW };
});

const me = () => profiles[0] as FakeProfile;

// ------------------------------------------------------------------ plans

describe('plans', () => {
  it('has the documented limits', () => {
    expect(PLAN_LIMITS).toEqual({ free: 250, pro: 3000, agency: 25000 });
  });

  it('maps product ids both ways and rejects unknown or unset ones', () => {
    expect(planForProduct('pdt_pro', PRODUCTS)).toBe('pro');
    expect(planForProduct('pdt_agency', PRODUCTS)).toBe('agency');
    expect(planForProduct('pdt_other', PRODUCTS)).toBeNull();
    expect(planForProduct('', { pro: undefined, agency: undefined })).toBeNull();
    expect(productForPlan('agency', PRODUCTS)).toBe('pdt_agency');
    expect(productForPlan('pro', { pro: undefined, agency: 'x' })).toBeNull();
  });
});

// ------------------------------------------------------------------ signature verification

describe('verifyWebhook', () => {
  const secret = `whsec_${Buffer.from('a-test-signing-key-32-bytes-long!!').toString('base64')}`;
  const body = JSON.stringify({ type: 'subscription.active', data: { subscription_id: 'sub_1' } });
  const sign = (payload: string, id = 'msg_1', at = new Date()) => {
    const wh = new Webhook(secret);
    return new Headers({
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(at.getTime() / 1000)),
      'webhook-signature': wh.sign(id, at, payload),
    });
  };

  it('accepts a correctly signed payload and returns the parsed JSON', () => {
    expect(verifyWebhook(body, sign(body), secret)).toEqual(JSON.parse(body));
  });

  it('rejects a tampered body', () => {
    expect(() => verifyWebhook(body.replace('sub_1', 'sub_2'), sign(body), secret)).toThrow();
  });

  it('rejects a signature made with another key', () => {
    const other = `whsec_${Buffer.from('another-signing-key-32-bytes-lng!').toString('base64')}`;
    expect(() => verifyWebhook(body, sign(body), other)).toThrow();
  });

  it('rejects a changed webhook-id', () => {
    const headers = sign(body);
    headers.set('webhook-id', 'msg_other');
    expect(() => verifyWebhook(body, headers, secret)).toThrow();
  });

  it('rejects a timestamp outside the 5 minute tolerance (replay protection)', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    expect(() => verifyWebhook(body, sign(body, 'msg_1', old), secret)).toThrow();
  });

  it('rejects missing headers', () => {
    expect(() => verifyWebhook(body, new Headers(), secret)).toThrow(/missing/);
  });
});

// ------------------------------------------------------------------ payload parsing

describe('parseSubscription', () => {
  it('reads the fields we use', () => {
    const sub = parseSubscription(event('subscription.active').data);
    expect(sub).toMatchObject({ id: 'sub_1', status: 'active', productId: 'pdt_pro', customerId: 'cus_1', customerEmail: 'a@example.com', userId: USER_A });
    expect(sub?.nextBillingDate?.toISOString()).toBe(NEXT_BILLING);
  });

  it('accepts a flat customer_id and ignores a malformed user id or date', () => {
    const sub = parseSubscription({ subscription_id: 's', customer_id: 'cus_9', metadata: { user_id: 'not-a-uuid' }, next_billing_date: 'garbage' });
    expect(sub).toMatchObject({ customerId: 'cus_9', userId: null, nextBillingDate: null });
  });

  it('returns null without a subscription id', () => {
    expect(parseSubscription({})).toBeNull();
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription('x')).toBeNull();
  });
});

// ------------------------------------------------------------------ date helpers

describe('date helpers', () => {
  it('adds one month and clamps to the last day', () => {
    expect(addOneMonthUtc(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addOneMonthUtc(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addOneMonthUtc(new Date('2026-12-15T10:00:00Z')).toISOString()).toBe('2027-01-15T10:00:00.000Z');
  });

  it('uses the provider billing date when it is in the future, otherwise a month from now', () => {
    expect(cycleEnd(new Date(NEXT_BILLING), NOW).toISOString()).toBe(NEXT_BILLING);
    expect(cycleEnd(new Date('2026-10-01T00:00:00Z'), NOW).toISOString()).toBe('2026-11-23T12:00:00.000Z');
    expect(cycleEnd(null, NOW).toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });
});

// ------------------------------------------------------------------ subscription.active

describe('subscription.active', () => {
  it('links the customer, applies the plan and starts a fresh quota window', async () => {
    expect(await send(event('subscription.active'))).toBe('processed');
    expect(me()).toMatchObject({
      plan_tier: 'pro',
      monthly_submission_limit: 3000,
      billing_customer_id: 'cus_1',
      billing_subscription_id: 'sub_1',
      current_cycle_usage: 0,
      cycle_resets_at: NEXT_BILLING,
      billing_updated_at: '2026-10-23T11:59:00.000Z',
    });
  });

  it('applies the agency plan from the product id, not from metadata', async () => {
    await send(event('subscription.active', { product_id: 'pdt_agency' }));
    expect(me()).toMatchObject({ plan_tier: 'agency', monthly_submission_limit: 25000 });
  });

  it('falls back to the customer id when the metadata is missing', async () => {
    profiles[0] = freeProfile({ billing_customer_id: 'cus_known' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    await send(event('subscription.active', { user_id: null, customer_id: 'cus_known', email: 'other@example.com' }));
    expect(me().plan_tier).toBe('pro');
  });

  it('falls back to the billing email when there is no metadata and no known customer', async () => {
    await send(event('subscription.active', { user_id: null, customer_id: 'cus_new', email: 'A@Example.com' }));
    expect(me()).toMatchObject({ plan_tier: 'pro', billing_customer_id: 'cus_new' });
  });

  it('does not guess when two accounts share the email: throws so Dodo retries', async () => {
    profiles.push(freeProfile({ id: USER_B }));
    await expect(send(event('subscription.active', { user_id: null, customer_id: 'cus_new' }))).rejects.toThrow(/no matching user/);
    expect(profiles.every((p) => p.plan_tier === 'free')).toBe(true);
  });

  it('throws and releases the claim when the user cannot be found, so the retry can succeed', async () => {
    await expect(send(event('subscription.active', { user_id: USER_B, customer_id: 'cus_x', email: 'nobody@example.com' }), 'msg_x')).rejects.toThrow(
      /no matching user/,
    );
    expect(ctx.claimed.has('msg_x')).toBe(false);
    expect(await send(event('subscription.active'), 'msg_x')).toBe('processed');
  });

  it('throws on a product we do not sell (misconfiguration must be visible, not silent)', async () => {
    await expect(send(event('subscription.active', { product_id: 'pdt_unknown' }))).rejects.toThrow(/unknown product/);
    expect(me().plan_tier).toBe('free');
  });

  it('is ignored when the payload says the subscription is not active', async () => {
    expect(await send(event('subscription.active', { status: 'pending' }))).toBe('ignored');
    expect(me().plan_tier).toBe('free');
  });

  it('replaces the subscription on file when the user subscribes again', async () => {
    profiles[0] = freeProfile({ billing_customer_id: 'cus_1', billing_subscription_id: null, billing_updated_at: '2026-10-01T00:00:00.000Z' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    await send(event('subscription.active', { subscription_id: 'sub_2' }));
    expect(me()).toMatchObject({ billing_subscription_id: 'sub_2', current_cycle_usage: 0 });
  });
});

// ------------------------------------------------------------------ idempotency and ordering

describe('idempotency and ordering', () => {
  it('acknowledges a redelivered webhook without applying it twice', async () => {
    expect(await send(event('subscription.active'), 'msg_dup')).toBe('processed');
    const writes = ctx.updates.length;
    me().current_cycle_usage = 77; // usage accrued after the first delivery
    expect(await send(event('subscription.active'), 'msg_dup')).toBe('duplicate');
    expect(ctx.updates.length).toBe(writes);
    expect(me().current_cycle_usage).toBe(77);
  });

  it('ignores event types it does not handle, without claiming them', async () => {
    expect(await send({ type: 'payment.succeeded', data: { payload_type: 'Payment' } }, 'msg_pay')).toBe('ignored');
    expect(await send({ type: 'subscription.update_payment_method', data: event('x').data }, 'msg_upm')).toBe('ignored');
    expect(ctx.claimed.size).toBe(0);
    expect(ctx.updates).toHaveLength(0);
  });

  it('ignores a payload without a subscription id', async () => {
    expect(await send({ type: 'subscription.active', data: {} })).toBe('ignored');
  });

  it('ignores an event older than one already applied (a late "active" cannot undo a cancellation)', async () => {
    profiles[0] = proProfile({ billing_updated_at: '2026-10-20T00:00:00.000Z' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };

    await send(event('subscription.cancelled', { status: 'cancelled', timestamp: '2026-10-22T10:00:00.000Z' }));
    expect(me().plan_tier).toBe('free');

    // Dodo delivers an OLDER "active" late.
    const late = await send(event('subscription.active', { timestamp: '2026-10-21T10:00:00.000Z' }));
    expect(late).toBe('ignored');
    expect(me()).toMatchObject({ plan_tier: 'free', monthly_submission_limit: 250 });
  });

  it('still applies an event with the same timestamp as the watermark', async () => {
    profiles[0] = proProfile({ billing_updated_at: '2026-10-23T11:59:00.000Z' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    expect(await send(event('subscription.plan_changed', { product_id: 'pdt_agency' }))).toBe('processed');
    expect(me().plan_tier).toBe('agency');
  });

  it('ignores events about an older subscription once the user has a new one', async () => {
    profiles[0] = proProfile({ billing_subscription_id: 'sub_new' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    expect(await send(event('subscription.cancelled', { subscription_id: 'sub_old', status: 'cancelled' }))).toBe('ignored');
    expect(me()).toMatchObject({ plan_tier: 'pro', billing_subscription_id: 'sub_new' });
  });

  it('uses the processing time when the event carries no timestamp', async () => {
    const e = event('subscription.active');
    delete (e as { timestamp?: string }).timestamp;
    await send(e);
    expect(me().billing_updated_at).toBe(NOW.toISOString());
  });
});

// ------------------------------------------------------------------ renewals and plan changes

describe('renewals and plan changes', () => {
  beforeEach(() => {
    profiles[0] = proProfile();
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
  });

  it('renewal starts a new quota window ending at the next billing date', async () => {
    expect(await send(event('subscription.renewed'))).toBe('processed');
    expect(me()).toMatchObject({ plan_tier: 'pro', current_cycle_usage: 0, cycle_resets_at: NEXT_BILLING });
  });

  it('renewal with a stale billing date falls back to one month from now', async () => {
    await send(event('subscription.renewed', { next_billing_date: '2026-09-01T00:00:00.000Z' }));
    expect(me().cycle_resets_at).toBe('2026-11-23T12:00:00.000Z');
  });

  it('a plan change updates plan and limit but KEEPS usage and the cycle (no quota trick)', async () => {
    const before = { usage: me().current_cycle_usage, resets: me().cycle_resets_at };
    await send(event('subscription.plan_changed', { product_id: 'pdt_agency' }));
    expect(me()).toMatchObject({ plan_tier: 'agency', monthly_submission_limit: 25000, current_cycle_usage: before.usage, cycle_resets_at: before.resets });
    await send(event('subscription.plan_changed', { product_id: 'pdt_pro', timestamp: '2026-10-23T12:30:00.000Z' }));
    expect(me()).toMatchObject({ plan_tier: 'pro', current_cycle_usage: before.usage });
  });

  it('a repeated "active" for the same subscription does not reset usage', async () => {
    await send(event('subscription.active'));
    expect(me().current_cycle_usage).toBe(1234);
  });

  it('plan_changed to a product we do not sell throws and changes nothing', async () => {
    await expect(send(event('subscription.plan_changed', { product_id: 'pdt_unknown' }))).rejects.toThrow(/unknown product/);
    expect(me().plan_tier).toBe('pro');
  });
});

// ------------------------------------------------------------------ suspension, ending, updates

describe('suspension and ending', () => {
  beforeEach(() => {
    profiles[0] = proProfile();
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
  });

  it('on_hold removes paid limits but keeps the subscription so reactivation can restore it', async () => {
    await send(event('subscription.on_hold', { status: 'on_hold', timestamp: '2026-10-23T08:00:00.000Z' }));
    expect(me()).toMatchObject({ plan_tier: 'free', monthly_submission_limit: 250, billing_subscription_id: 'sub_1', current_cycle_usage: 1234 });

    await send(event('subscription.active', { timestamp: '2026-10-23T09:00:00.000Z' }));
    expect(me()).toMatchObject({ plan_tier: 'pro', monthly_submission_limit: 3000, current_cycle_usage: 1234 });
  });

  it('paused behaves like on_hold, and unpaused restores the plan', async () => {
    await send(event('subscription.paused', { status: 'paused', timestamp: '2026-10-23T08:00:00.000Z' }));
    expect(me().plan_tier).toBe('free');
    await send(event('subscription.unpaused', { timestamp: '2026-10-23T09:00:00.000Z' }));
    expect(me().plan_tier).toBe('pro');
  });

  it.each(['subscription.cancelled', 'subscription.expired', 'subscription.failed'])(
    '%s returns the user to free, frees the subscription slot and keeps the customer',
    async (type) => {
      await send(event(type, { status: 'cancelled' }));
      expect(me()).toMatchObject({ plan_tier: 'free', monthly_submission_limit: 250, billing_subscription_id: null, billing_customer_id: 'cus_1' });
    },
  );

  it('past_due keeps access (grace period)', async () => {
    expect(await send(event('subscription.updated', { status: 'past_due' }))).toBe('ignored');
    expect(me().plan_tier).toBe('pro');
  });

  it('after cancelling, the user can subscribe again and gets a fresh quota window', async () => {
    await send(event('subscription.cancelled', { status: 'cancelled', timestamp: '2026-10-23T08:00:00.000Z' }));
    await send(event('subscription.active', { subscription_id: 'sub_2', timestamp: '2026-10-23T10:00:00.000Z' }));
    expect(me()).toMatchObject({ plan_tier: 'pro', billing_subscription_id: 'sub_2', current_cycle_usage: 0 });
  });
});

describe('subscription.updated', () => {
  beforeEach(() => {
    profiles[0] = proProfile();
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
  });

  it('syncs the plan when active', async () => {
    expect(await send(event('subscription.updated', { product_id: 'pdt_agency' }))).toBe('processed');
    expect(me()).toMatchObject({ plan_tier: 'agency', current_cycle_usage: 1234 });
  });

  it.each(['cancelled', 'expired', 'failed'])('downgrades when the payload status is %s', async (status) => {
    await send(event('subscription.updated', { status }));
    expect(me()).toMatchObject({ plan_tier: 'free', billing_subscription_id: null });
  });

  it('suspends when on_hold', async () => {
    await send(event('subscription.updated', { status: 'on_hold' }));
    expect(me()).toMatchObject({ plan_tier: 'free', billing_subscription_id: 'sub_1' });
  });

  it('never adopts a subscription it is not already tracking', async () => {
    expect(await send(event('subscription.updated', { subscription_id: 'sub_other' }))).toBe('ignored');
    expect(me().billing_subscription_id).toBe('sub_1');
  });

  it('does not adopt a subscription for a user who has none on file (only "active" may do that)', async () => {
    profiles[0] = freeProfile({ billing_updated_at: '2026-10-01T00:00:00.000Z' });
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    expect(await send(event('subscription.updated'))).toBe('ignored');
    expect(me()).toMatchObject({ plan_tier: 'free', billing_subscription_id: null });
  });

  it('ignores unknown products and pending status', async () => {
    expect(await send(event('subscription.updated', { product_id: 'pdt_unknown' }))).toBe('ignored');
    expect(await send(event('subscription.updated', { status: 'pending' }))).toBe('ignored');
    expect(me().plan_tier).toBe('pro');
  });
});

// ------------------------------------------------------------------ isolation

describe('isolation between users', () => {
  it('only ever writes to the matched profile', async () => {
    profiles.push(freeProfile({ id: USER_B, email: 'b@example.com' }));
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    await send(event('subscription.active'));
    expect(ctx.updates.map((u) => u.id)).toEqual([USER_A]);
    expect(profiles[1]).toMatchObject({ plan_tier: 'free', billing_subscription_id: null });
  });

  it('metadata wins over a different customer email, so a forged email cannot hijack another account', async () => {
    profiles.push(freeProfile({ id: USER_B, email: 'b@example.com' }));
    ctx = makeStore(profiles);
    deps = { ...deps, store: ctx.store };
    await send(event('subscription.active', { user_id: USER_A, email: 'b@example.com' }));
    expect(profiles[0]?.plan_tier).toBe('pro');
    expect(profiles[1]?.plan_tier).toBe('free');
  });
});
