import { problems } from './problem';
import type { Payload } from './types';

const MAX_FIELDS = 200;

export function contentMime(request: Request): string {
  return (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/** Read the request body, aborting as soon as it exceeds `maxBytes`. */
async function readBody(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) throw problems.payloadTooLarge(maxBytes);
  }
  if (request.body === null) return new Uint8Array(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = value as Uint8Array;
    total += chunk.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw problems.payloadTooLarge(maxBytes);
    }
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Repeated keys become arrays. Built via fromEntries so a `__proto__` key stays plain data. */
function collect(entries: Iterable<[string, unknown]>): Payload {
  const map = new Map<string, unknown>();
  for (const [key, value] of entries) {
    if (!map.has(key) && map.size >= MAX_FIELDS) {
      throw problems.invalidBody(`A submission may contain at most ${MAX_FIELDS} fields.`);
    }
    const existing = map.get(key);
    if (existing === undefined) {
      map.set(key, value);
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      map.set(key, [existing, value]);
    }
  }
  return Object.fromEntries(map);
}

function parseJson(bytes: Uint8Array): Payload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw problems.invalidBody('The request body is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw problems.invalidBody('The JSON body must be an object of field names to values.');
  }
  if (Object.keys(parsed).length > MAX_FIELDS) {
    throw problems.invalidBody(`A submission may contain at most ${MAX_FIELDS} fields.`);
  }
  return parsed as Payload;
}

async function parseMultipart(bytes: Uint8Array, contentType: string): Promise<Payload> {
  let form: FormData;
  try {
    form = await new Response(bytes, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw problems.invalidBody('The multipart/form-data body is malformed.');
  }
  const entries: Array<[string, unknown]> = [];
  form.forEach((value, key) => {
    // File contents are deliberately not stored; record metadata so the owner can see an upload was attempted.
    entries.push([key, typeof value === 'string' ? value : { filename: value.name, size: value.size, contentType: value.type, stored: false }]);
  });
  return collect(entries);
}

/**
 * Parse application/json, application/x-www-form-urlencoded or multipart/form-data
 * into a flat-ish payload object. Throws ProblemError on any client error.
 */
export async function parseBody(request: Request, maxBytes: number): Promise<Payload> {
  const mime = contentMime(request);
  if (mime !== 'application/json' && mime !== 'application/x-www-form-urlencoded' && mime !== 'multipart/form-data') {
    throw problems.unsupportedMediaType();
  }
  const bytes = await readBody(request, maxBytes);
  if (mime === 'application/json') return parseJson(bytes);
  if (mime === 'application/x-www-form-urlencoded') {
    return collect(new URLSearchParams(new TextDecoder().decode(bytes)).entries());
  }
  return parseMultipart(bytes, request.headers.get('content-type') ?? '');
}
