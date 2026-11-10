import { log } from '@/lib/log';
import type { PlanTier } from '@/lib/types';
import { UUID_RE } from '@/lib/utils';
import { PLAN_LIMITS, type PaidPlan } from './plans';

/**
 * Dodo Payments webhook business logic. Pure with respect to I/O: the database and the
 * clock come in through `BillingDeps`, so the full behaviour is unit-tested without Dodo or Supabase.
 *
 * Design rules:
 *  - Every write is ABSOLUTE ("set plan to pro"), never relative, so replays are harmless.
 *  - Each webhook-id is claimed first; duplicates are acknowledged and skipped.
 *  - Dodo guarantees no ordering, so each profile stores the timestamp of the newest event
 *    applied (`billing_updated_at`) and older events are ignored. A late `subscription.active`
 *    can therefore never resurrect a subscription that was already cancelled.
 *  - If a handler throws, the claim is released and the error propagates, so the route
 *    answers 5xx and Dodo retries (up to 8 attempts over about a day).
 */

export interface ProfileRef {
  id: string;
  plan_tier: PlanTier;
  billing_customer_id: string | null;
  billing_subscription_id: string | null;
  billing_updated_at: string | null;
}

export interface ProfilePatch {
  plan_tier?: PlanTier;
  monthly_submission_limit?: number;
  billing_customer_id?: string | null;
  billing_subscription_id?: string | null;
  billing_updated_at?: string;
  current_cycle_usage?: number;
  cycle_resets_at?: string;
}

export interface BillingStore {
  /** Returns true if this call claimed the webhook id, false if it was already claimed. */
  claimEvent(webhookId: string, type: string): Promise<boolean>;
  releaseEvent(webhookId: string): Promise<void>;
  findProfileById(id: string): Promise<ProfileRef | null>;
  findProfileByCustomerId(customerId: string): Promise<ProfileRef | null>;
  /** Must return null unless exactly one profile matches. */
  findProfileByEmail(email: string): Promise<ProfileRef | null>;
  updateProfile(id: string, patch: ProfilePatch): Promise<void>;
}

export interface BillingDeps {
  store: BillingStore;
  planForProduct(productId: string): PaidPlan | null;
  now(): Date;
}

export interface DodoEvent {
  type: string;
  /** ISO 8601 time the event occurred, set by Dodo. */
  timestamp?: string;
  data?: unknown;
}

export type EventOutcome = 'processed' | 'duplicate' | 'ignored';
type HandlerResult = 'processed' | 'ignored';

/** Subscription events that change what a user may do. Everything else is acknowledged and skipped. */
const ACTIVATING = new Set(['subscription.active', 'subscription.renewed', 'subscription.plan_changed', 'subscription.unpaused']);
const SUSPENDING = new Set(['subscription.on_hold', 'subscription.paused']);
const ENDING = new Set(['subscription.cancelled', 'subscription.expired', 'subscription.failed']);
const HANDLED_TYPES: ReadonlySet<string> = new Set([...ACTIVATING, ...SUSPENDING, ...ENDING, 'subscription.updated']);

export async function processDodoEvent(webhookId: string, event: DodoEvent, deps: BillingDeps): Promise<EventOutcome> {
  // Unhandled types are acknowledged without touching the database.
  if (!HANDLED_TYPES.has(event.type)) return 'ignored';
  if (!(await deps.store.claimEvent(webhookId, event.type))) return 'duplicate';

  try {
    return await handleSubscriptionEvent(event, deps);
  } catch (err) {
    await deps.store.releaseEvent(webhookId).catch(() => undefined);
    throw err;
  }
}

// ---------------------------------------------------------------- payload

interface Subscription {
  id: string;
  status: string | null;
  productId: string | null;
  customerId: string | null;
  customerEmail: string | null;
  userId: string | null;
  nextBillingDate: Date | null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Reads the fields we need from `event.data`, tolerating missing ones. Returns null if there is no subscription id. */
export function parseSubscription(data: unknown): Subscription | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const id = str(d['subscription_id']);
  if (!id) return null;

  const customer = typeof d['customer'] === 'object' && d['customer'] !== null ? (d['customer'] as Record<string, unknown>) : {};
  const metadata = typeof d['metadata'] === 'object' && d['metadata'] !== null ? (d['metadata'] as Record<string, unknown>) : {};
  const userId = str(metadata['user_id']);
  const next = str(d['next_billing_date']);
  const nextDate = next ? new Date(next) : null;

  return {
    id,
    status: str(d['status']),
    productId: str(d['product_id']),
    customerId: str(customer['customer_id']) ?? str(d['customer_id']),
    customerEmail: str(customer['email']),
    userId: userId && UUID_RE.test(userId) ? userId : null,
    nextBillingDate: nextDate && !Number.isNaN(nextDate.getTime()) ? nextDate : null,
  };
}

// ---------------------------------------------------------------- helpers

function planPatch(plan: PlanTier): ProfilePatch {
  return { plan_tier: plan, monthly_submission_limit: PLAN_LIMITS[plan] };
}

/** Same-day-next-month in UTC, clamped to the last day (Jan 31 -> Feb 28/29), like Postgres. */
export function addOneMonthUtc(from: Date): Date {
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(year, month, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes(), from.getUTCSeconds(), from.getUTCMilliseconds()),
  );
}

/** When the quota window should next reset: the provider's next billing date if it is in the future, else a month from now. */
export function cycleEnd(next: Date | null, now: Date): Date {
  return next !== null && next.getTime() > now.getTime() ? next : addOneMonthUtc(now);
}

function eventTime(event: DodoEvent, now: Date): Date {
  const parsed = event.timestamp ? new Date(event.timestamp) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : now;
}

/**
 * Finds our user for a subscription. Order: the user id our checkout stamped into the metadata,
 * then the Dodo customer id, then the billing email (only when nothing stronger is available).
 */
async function findProfile(sub: Subscription, deps: BillingDeps): Promise<ProfileRef | null> {
  if (sub.userId) {
    const byId = await deps.store.findProfileById(sub.userId);
    if (byId) return byId;
  }
  if (sub.customerId) {
    const byCustomer = await deps.store.findProfileByCustomerId(sub.customerId);
    if (byCustomer) return byCustomer;
  }
  if (sub.customerEmail) return deps.store.findProfileByEmail(sub.customerEmail);
  return null;
}

// ---------------------------------------------------------------- dispatch

async function handleSubscriptionEvent(event: DodoEvent, deps: BillingDeps): Promise<HandlerResult> {
  const sub = parseSubscription(event.data);
  if (!sub) {
    log('warn', 'dodo event without a subscription id', { type: event.type });
    return 'ignored';
  }

  const profile = await findProfile(sub, deps);
  if (!profile) {
    // The user always exists before they pay, so an activation for an unknown user is a real
    // problem: throw so Dodo retries and the failure shows up in the logs.
    if (event.type === 'subscription.active') throw new Error(`no matching user for subscription ${sub.id}`);
    return 'ignored';
  }

  const at = eventTime(event, deps.now());

  // Older than something we already applied: skip, or a late event would undo newer state.
  if (profile.billing_updated_at !== null && at.getTime() < new Date(profile.billing_updated_at).getTime()) {
    log('info', 'stale billing event ignored', { userId: profile.id, type: event.type });
    return 'ignored';
  }

  // Only activation may replace the subscription on file. Anything else about a different
  // (older) subscription must not touch a user who has since subscribed again.
  const isNewSubscription = profile.billing_subscription_id !== sub.id;
  if (isNewSubscription && event.type !== 'subscription.active' && profile.billing_subscription_id !== null) return 'ignored';

  const stamp = at.toISOString();

  if (ENDING.has(event.type)) return end(profile, sub, stamp, deps);
  if (SUSPENDING.has(event.type)) return suspend(profile, sub, stamp, deps);
  if (event.type === 'subscription.updated') return updated(profile, sub, stamp, isNewSubscription, deps);
  return activate(event.type, profile, sub, stamp, isNewSubscription, deps);
}

// ---------------------------------------------------------------- handlers

/**
 * active / renewed / plan_changed / unpaused: the subscription is paid and running.
 *  - A NEW subscription (first activation) or a renewal starts a fresh quota window.
 *  - A plan change or a reactivation of the same subscription keeps the current usage, or
 *    switching plans back and forth would become an infinite-quota trick.
 */
async function activate(
  type: string,
  profile: ProfileRef,
  sub: Subscription,
  stamp: string,
  isNewSubscription: boolean,
  deps: BillingDeps,
): Promise<HandlerResult> {
  if (sub.status !== null && sub.status !== 'active') return 'ignored'; // payload says it is not running

  const plan = sub.productId ? deps.planForProduct(sub.productId) : null;
  if (!plan) throw new Error(`subscription ${sub.id} has an unknown product (${sub.productId ?? 'none'}); check DODO_PRODUCT_PRO / DODO_PRODUCT_AGENCY`);

  const resetsQuota = type === 'subscription.renewed' || (type === 'subscription.active' && isNewSubscription);
  await deps.store.updateProfile(profile.id, {
    ...planPatch(plan),
    billing_customer_id: sub.customerId ?? profile.billing_customer_id,
    billing_subscription_id: sub.id,
    billing_updated_at: stamp,
    ...(resetsQuota ? { current_cycle_usage: 0, cycle_resets_at: cycleEnd(sub.nextBillingDate, deps.now()).toISOString() } : {}),
  });
  log('info', 'plan applied', { userId: profile.id, plan, type, resetsQuota });
  return 'processed';
}

/** on_hold / paused: no paid access, but keep the subscription id so reactivation restores it. */
async function suspend(profile: ProfileRef, sub: Subscription, stamp: string, deps: BillingDeps): Promise<HandlerResult> {
  await deps.store.updateProfile(profile.id, {
    ...planPatch('free'),
    billing_customer_id: sub.customerId ?? profile.billing_customer_id,
    billing_subscription_id: sub.id,
    billing_updated_at: stamp,
  });
  log('info', 'subscription suspended, free limits apply', { userId: profile.id });
  return 'processed';
}

/**
 * cancelled / expired / failed: the subscription is over. The user returns to the free tier and
 * may subscribe again. The customer id is kept so past invoices stay reachable in the portal.
 * A cancellation therefore takes effect when Dodo reports it (see docs/billing.md).
 */
async function end(profile: ProfileRef, sub: Subscription, stamp: string, deps: BillingDeps): Promise<HandlerResult> {
  await deps.store.updateProfile(profile.id, {
    ...planPatch('free'),
    billing_customer_id: sub.customerId ?? profile.billing_customer_id,
    billing_subscription_id: null,
    billing_updated_at: stamp,
  });
  log('info', 'subscription ended, reverted to free', { userId: profile.id });
  return 'processed';
}

/** subscription.updated fires for any field change, so decide from the status it carries. */
async function updated(profile: ProfileRef, sub: Subscription, stamp: string, isNewSubscription: boolean, deps: BillingDeps): Promise<HandlerResult> {
  // `updated` must never adopt a subscription we are not already tracking.
  if (isNewSubscription) return 'ignored';

  switch (sub.status) {
    case 'cancelled':
    case 'expired':
    case 'failed':
      return end(profile, sub, stamp, deps);
    case 'on_hold':
    case 'paused':
      return suspend(profile, sub, stamp, deps);
    case 'active': {
      const plan = sub.productId ? deps.planForProduct(sub.productId) : null;
      if (!plan) return 'ignored';
      await deps.store.updateProfile(profile.id, { ...planPatch(plan), billing_updated_at: stamp });
      log('info', 'plan synced from subscription update', { userId: profile.id, plan });
      return 'processed';
    }
    default:
      return 'ignored'; // pending, past_due (grace period: access continues), unknown
  }
}
