import { Webhook } from 'standardwebhooks';

/**
 * Verifies a Dodo Payments webhook (Standard Webhooks spec): HMAC-SHA256 over
 * `{webhook-id}.{webhook-timestamp}.{raw body}`, with a 5 minute timestamp tolerance.
 * Returns the parsed JSON body, or throws if the signature, timestamp or JSON is bad.
 *
 * Kept separate from the route so it can be unit-tested with real signatures.
 */
export function verifyWebhook(rawBody: string, headers: Headers, secret: string): unknown {
  const id = headers.get('webhook-id');
  const timestamp = headers.get('webhook-timestamp');
  const signature = headers.get('webhook-signature');
  if (!id || !timestamp || !signature) throw new Error('missing webhook headers');
  const wh = new Webhook(secret);
  return wh.verify(rawBody, { 'webhook-id': id, 'webhook-timestamp': timestamp, 'webhook-signature': signature });
}
