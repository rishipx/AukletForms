/**
 * RFC 7807 "problem details" errors. Every non-2xx/3xx response from the
 * Worker is `application/problem+json` with a stable `type` slug, so clients
 * can branch on `type` rather than parsing prose.
 */

const PROBLEM_TYPE_BASE = 'https://auklet.dev/problems/';

interface ProblemOptions {
  headers?: Record<string, string>;
  extensions?: Record<string, unknown>;
}

export class ProblemError extends Error {
  readonly status: number;
  readonly slug: string;
  readonly title: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly extensions: Readonly<Record<string, unknown>>;

  constructor(status: number, slug: string, title: string, detail: string, options: ProblemOptions = {}) {
    super(detail);
    this.name = 'ProblemError';
    this.status = status;
    this.slug = slug;
    this.title = title;
    this.headers = options.headers ?? {};
    this.extensions = options.extensions ?? {};
  }
}

export const problems = {
  notFound: (detail = 'The requested resource does not exist.') => new ProblemError(404, 'not-found', 'Not Found', detail),

  methodNotAllowed: () =>
    new ProblemError(405, 'method-not-allowed', 'Method Not Allowed', 'This endpoint accepts POST and OPTIONS requests only.', {
      headers: { allow: 'POST, OPTIONS' },
    }),

  originNotAllowed: () => new ProblemError(403, 'origin-not-allowed', 'Origin Not Allowed', "The request origin is not in this form's allowed domains."),

  unsupportedMediaType: () =>
    new ProblemError(
      415,
      'unsupported-media-type',
      'Unsupported Media Type',
      'Send the body as application/json, multipart/form-data or application/x-www-form-urlencoded.',
    ),

  payloadTooLarge: (limitBytes: number) =>
    new ProblemError(413, 'payload-too-large', 'Payload Too Large', `The request body exceeds the ${limitBytes}-byte limit.`, {
      extensions: { limitBytes },
    }),

  submissionTooLarge: (limitBytes: number) =>
    new ProblemError(
      413,
      'submission-too-large',
      'Submission Too Large',
      `The submitted fields add up to more than ${limitBytes} bytes. File contents are never stored; send text fields only.`,
      {
        extensions: { limitBytes },
      },
    ),

  rateLimited: () =>
    new ProblemError(429, 'rate-limited', 'Too Many Requests', 'Too many submissions from your network. Please wait a minute and try again.', {
      headers: { 'retry-after': '60' },
    }),

  invalidBody: (detail: string) => new ProblemError(400, 'invalid-body', 'Invalid Request Body', detail),

  turnstileRequired: () =>
    new ProblemError(400, 'turnstile-required', 'Bot Check Required', 'This form requires a Cloudflare Turnstile response (cf-turnstile-response).'),

  turnstileFailed: (errorCodes: string[]) =>
    new ProblemError(403, 'turnstile-failed', 'Bot Check Failed', 'Cloudflare Turnstile rejected the response token.', {
      extensions: { errorCodes },
    }),

  quotaExceeded: () =>
    new ProblemError(429, 'quota-exceeded', 'Submission Quota Exceeded', "This form's owner has reached the monthly submission limit.", {
      headers: { 'retry-after': '3600' },
    }),

  upstreamUnavailable: (detail = 'A required upstream service is temporarily unavailable. Please retry shortly.') =>
    new ProblemError(503, 'service-unavailable', 'Service Unavailable', detail, {
      headers: { 'retry-after': '5' },
    }),

  misconfigured: () =>
    new ProblemError(500, 'server-misconfigured', 'Server Misconfigured', 'The service is not configured correctly. Please contact support.'),

  internal: () => new ProblemError(500, 'internal-error', 'Internal Server Error', 'An unexpected error occurred.'),
} as const;

export function problemResponse(err: ProblemError, requestId: string, extraHeaders: Record<string, string> = {}): Response {
  const body = {
    type: `${PROBLEM_TYPE_BASE}${err.slug}`,
    title: err.title,
    status: err.status,
    detail: err.message,
    instance: `urn:auklet:request:${requestId}`,
    requestId,
    ...err.extensions,
  };
  return new Response(JSON.stringify(body), {
    status: err.status,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
      ...err.headers,
    },
  });
}
