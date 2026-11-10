/**
 * Origin allow-listing and CORS headers.
 *
 * `allowed_domains` entries look like `example.com`, `localhost:3000` or
 * `*.example.com`. Matching rules:
 *  - exact host match, case-insensitive, scheme ignored (http and https both match);
 *  - the port must match exactly (an entry without a port matches only the default port);
 *  - `*.example.com` matches any subdomain but NOT `example.com` itself;
 *  - a pasted scheme/path (`https://example.com/contact`) is tolerated and stripped.
 */

interface AllowedEntry {
  hostname: string;
  port: string;
  wildcard: boolean;
}

export function parseAllowedEntry(raw: string): AllowedEntry | null {
  let s = raw.trim().toLowerCase();
  if (s === '') return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  const cut = s.search(/[/?#]/);
  if (cut !== -1) s = s.slice(0, cut);
  let wildcard = false;
  if (s.startsWith('*.')) {
    wildcard = true;
    s = s.slice(2);
  }
  if (s === '' || s.includes('*') || s.includes('@')) return null;
  try {
    const url = new URL(`http://${s}`);
    if (url.hostname === '') return null;
    return { hostname: url.hostname, port: url.port, wildcard };
  } catch {
    return null;
  }
}

export function originMatches(origin: string, allowedDomains: readonly string[]): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false; // includes the literal "null" origin
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  for (const raw of allowedDomains) {
    const entry = parseAllowedEntry(raw);
    if (entry === null || entry.port !== url.port) continue;
    const hit = entry.wildcard ? url.hostname.endsWith(`.${entry.hostname}`) : url.hostname === entry.hostname;
    if (hit) return true;
  }
  return false;
}

export type CorsDecision = { allowed: true; headers: Record<string, string> } | { allowed: false };

/**
 * Decide whether a request may proceed and which CORS headers to attach.
 *  - empty allow-list            -> allowed, `Access-Control-Allow-Origin: *`
 *  - no Origin and no Referer    -> allowed (server-to-server / curl), no CORS headers
 *  - Origin (else Referer) match -> allowed, origin echoed back
 *  - anything else               -> denied (caller returns 403)
 */
export function decideCors(request: Request, allowedDomains: readonly string[]): CorsDecision {
  if (allowedDomains.length === 0) {
    return { allowed: true, headers: { 'access-control-allow-origin': '*' } };
  }

  const origin = request.headers.get('origin');
  if (origin !== null) {
    return originMatches(origin, allowedDomains) ? { allowed: true, headers: { 'access-control-allow-origin': origin, vary: 'Origin' } } : { allowed: false };
  }

  // Native form posts from some browsers omit Origin but still send Referer.
  const referer = request.headers.get('referer');
  if (referer !== null) {
    let refererOrigin: string | null = null;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      refererOrigin = null;
    }
    if (refererOrigin !== null) {
      return originMatches(refererOrigin, allowedDomains) ? { allowed: true, headers: { vary: 'Origin' } } : { allowed: false };
    }
  }

  return { allowed: true, headers: { vary: 'Origin' } };
}

export function preflightHeaders(request: Request, base: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...base };
  if (headers['access-control-allow-origin'] !== undefined) {
    headers['access-control-allow-methods'] = 'POST, OPTIONS';
    headers['access-control-allow-headers'] = request.headers.get('access-control-request-headers') ?? 'Content-Type, Accept';
    headers['access-control-max-age'] = '86400';
  }
  return headers;
}
