import { SITE_URL } from '@/lib/config/env';

/** RFC 7807 problem details for the dashboard's own API routes. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly slug: string,
    readonly title: string,
    detail: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(detail);
    this.name = 'ApiProblem';
  }
}

export const apiProblems = {
  badOrigin: () => new ApiProblem(403, 'bad-origin', 'Forbidden', 'This request must come from the Auklet dashboard.'),
  unauthorized: () => new ApiProblem(401, 'unauthorized', 'Unauthorized', 'Sign in to continue.'),
  invalidRequest: (detail: string) => new ApiProblem(400, 'invalid-request', 'Invalid Request', detail),
  alreadySubscribed: () =>
    new ApiProblem(
      409,
      'already-subscribed',
      'Already Subscribed',
      'You already have an active subscription. Use "Manage Subscription & Invoices" to change or cancel it.',
    ),
  noBillingAccount: () =>
    new ApiProblem(409, 'no-billing-account', 'No Billing Account', 'You have not subscribed yet, so there is nothing to manage. Pick a plan first.'),
  billingNotConfigured: () => new ApiProblem(503, 'billing-not-configured', 'Billing Unavailable', 'Billing is not configured on this deployment.'),
  providerError: () =>
    new ApiProblem(
      502,
      'billing-provider-error',
      'Billing Provider Error',
      'Our payment provider could not complete the request. Please try again in a moment.',
      { 'retry-after': '5' },
    ),
  internal: () => new ApiProblem(500, 'internal-error', 'Internal Server Error', 'An unexpected error occurred.'),
} as const;

export function problemJson(problem: ApiProblem, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      type: `https://auklet.dev/problems/${problem.slug}`,
      title: problem.title,
      status: problem.status,
      detail: problem.message,
      ...extra,
    }),
    {
      status: problem.status,
      headers: { 'content-type': 'application/problem+json; charset=utf-8', 'cache-control': 'no-store', ...problem.headers },
    },
  );
}

/** Where this dashboard is publicly reachable (for billing return URLs). */
export function siteOrigin(request: Request): string {
  if (SITE_URL !== '') return SITE_URL;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') ?? 'https';
  return host ? `${proto}://${host}` : new URL(request.url).origin;
}

/**
 * CSRF defence for cookie-authenticated POST routes: browsers always send Origin
 * on fetch() POSTs, and a cross-site page cannot forge it. Require it to match
 * this site.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin === null) throw apiProblems.badOrigin();
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const allowed = new Set<string>();
  if (SITE_URL !== '') allowed.add(SITE_URL);
  if (host) {
    allowed.add(`https://${host}`);
    allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw apiProblems.badOrigin();
}
