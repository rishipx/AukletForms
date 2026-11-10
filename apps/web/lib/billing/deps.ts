import 'server-only';
import { planForProduct, productMapFromEnv } from './plans';
import { createSupabaseBillingStore } from './store';
import type { BillingDeps } from './handlers';

/** Production wiring for the webhook: real database, real clock. */
export function createBillingDeps(): BillingDeps {
  const products = productMapFromEnv();
  return {
    store: createSupabaseBillingStore(),
    planForProduct: (productId) => planForProduct(productId, products),
    now: () => new Date(),
  };
}
