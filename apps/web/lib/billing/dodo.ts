import 'server-only';
import DodoPayments from 'dodopayments';

let client: DodoPayments | null = null;

export class BillingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingConfigError';
  }
}

/**
 * Dodo Payments has two separate worlds. Test keys only work against test.dodopayments.com and
 * live keys against live.dodopayments.com, so the mode is an explicit env var (default: test).
 * That default means a forgotten variable can never move real money.
 */
export function dodoEnvironment(): 'test_mode' | 'live_mode' {
  return process.env['DODO_PAYMENTS_ENVIRONMENT'] === 'live_mode' ? 'live_mode' : 'test_mode';
}

export function getDodo(): DodoPayments {
  const key = process.env['DODO_PAYMENTS_API_KEY'];
  if (!key) throw new BillingConfigError('DODO_PAYMENTS_API_KEY is not set.');
  client ??= new DodoPayments({ bearerToken: key, environment: dodoEnvironment(), maxRetries: 2, timeout: 15_000 });
  return client;
}

export function getWebhookKey(): string {
  const key = process.env['DODO_PAYMENTS_WEBHOOK_KEY'];
  if (!key) throw new BillingConfigError('DODO_PAYMENTS_WEBHOOK_KEY is not set.');
  return key;
}
