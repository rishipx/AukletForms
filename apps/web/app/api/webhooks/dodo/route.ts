import { ApiProblem, problemJson } from '@/lib/http/api';
import { createBillingDeps } from '@/lib/billing/deps';
import { BillingConfigError, getWebhookKey } from '@/lib/billing/dodo';
import { processDodoEvent, type DodoEvent } from '@/lib/billing/handlers';
import { verifyWebhook } from '@/lib/billing/webhook';
import { errorMessage, log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Dodo Payments webhook receiver.
 *  - Verifies the signature against the RAW body (parsing it first would break the HMAC).
 *  - 401 for bad signatures: Dodo's own examples use 401, and retrying cannot fix it.
 *  - 5xx for processing failures: Dodo retries with backoff (up to 8 attempts), and the
 *    handlers are idempotent, so retries are safe.
 */
export async function POST(request: Request): Promise<Response> {
  const webhookId = request.headers.get('webhook-id');
  if (!webhookId) {
    return problemJson(new ApiProblem(400, 'missing-webhook-id', 'Bad Request', 'The webhook-id header is missing.'));
  }

  let event: DodoEvent;
  try {
    const rawBody = await request.text();
    const parsed = verifyWebhook(rawBody, request.headers, getWebhookKey());
    if (typeof parsed !== 'object' || parsed === null || typeof (parsed as { type?: unknown }).type !== 'string') {
      throw new Error('payload has no event type');
    }
    event = parsed as DodoEvent;
  } catch (err) {
    if (err instanceof BillingConfigError) {
      log('error', 'dodo webhook misconfigured', { error: err.message });
      return problemJson(new ApiProblem(500, 'webhook-misconfigured', 'Server Misconfigured', 'The webhook endpoint is not configured.'));
    }
    log('warn', 'dodo webhook signature rejected', { error: errorMessage(err) });
    return problemJson(new ApiProblem(401, 'invalid-signature', 'Unauthorized', 'The webhook signature could not be verified.'));
  }

  try {
    const outcome = await processDodoEvent(webhookId, event, createBillingDeps());
    log('info', 'dodo event handled', { webhookId, type: event.type, outcome });
    return Response.json({ received: true, outcome });
  } catch (err) {
    log('error', 'dodo event processing failed', { webhookId, type: event.type, error: errorMessage(err) });
    return problemJson(new ApiProblem(500, 'processing-failed', 'Processing Failed', 'The event could not be processed. Dodo will retry.'));
  }
}
