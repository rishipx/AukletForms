import type { PlanTier } from '@/lib/types';

export type PaidPlan = 'pro' | 'agency';

/** Monthly submission allowance per plan. These are the single source of truth for quota limits. */
export const PLAN_LIMITS: Readonly<Record<PlanTier, number>> = {
  free: 250,
  pro: 3000,
  agency: 25000,
};

/** How long submissions are kept. The database's purge_old_data() uses the same numbers (a test keeps them in sync). */
export const RETENTION_DAYS: Readonly<Record<PlanTier, number>> = {
  free: 30,
  pro: 90,
  agency: 365,
};

export const PLAN_LABELS: Readonly<Record<PlanTier, string>> = {
  free: 'Free',
  pro: 'Pro',
  agency: 'Agency',
};

export function isPaidPlan(value: unknown): value is PaidPlan {
  return value === 'pro' || value === 'agency';
}

/** Dodo Payments product ids (`pdt_...`) for the two subscription products we sell. */
export interface ProductMap {
  pro: string | undefined;
  agency: string | undefined;
}

export function productMapFromEnv(env: Record<string, string | undefined> = process.env): ProductMap {
  return { pro: env['DODO_PRODUCT_PRO'] || undefined, agency: env['DODO_PRODUCT_AGENCY'] || undefined };
}

/** Maps a Dodo product id to our plan. Returns null for products we do not sell. */
export function planForProduct(productId: string, products: ProductMap): PaidPlan | null {
  if (products.pro !== undefined && productId === products.pro) return 'pro';
  if (products.agency !== undefined && productId === products.agency) return 'agency';
  return null;
}

export function productForPlan(plan: PaidPlan, products: ProductMap): string | null {
  return products[plan] ?? null;
}
