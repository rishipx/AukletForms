import type { NextRequest } from 'next/server';
import { log } from '@/lib/log';
import { buildCsv } from '@/lib/submissions/csv';
import { createClient } from '@/lib/supabase/server';
import { SUBMISSION_COLUMNS, type SubmissionRecord } from '@/lib/types';
import { UUID_RE } from '@/lib/utils';

/** Lets Excel recognise the file as UTF-8. */
const UTF8_BOM = '\uFEFF';
const BATCH_SIZE = 1000;
const MAX_ROWS = 50_000;

function slug(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s === '' ? 'form' : s;
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return new Response('Not found', { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  // Both queries run as the signed-in user, so RLS guarantees they can only export their own data.
  const { data: form } = await supabase.from('forms').select('name').eq('id', id).maybeSingle();
  if (!form) return new Response('Not found', { status: 404 });

  const rows: SubmissionRecord[] = [];
  let truncated = false;
  for (let from = 0; ; from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('form_id', id)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + BATCH_SIZE - 1);
    if (error) {
      log('error', 'csv export query failed', { code: error.code });
      return new Response('Export failed', { status: 500 });
    }
    const batch = (data ?? []) as unknown as SubmissionRecord[];
    rows.push(...batch);
    if (rows.length >= MAX_ROWS) {
      truncated = batch.length === BATCH_SIZE;
      break;
    }
    if (batch.length < BATCH_SIZE) break;
  }

  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slug((form as { name: string }).name)}-submissions-${date}.csv`;

  return new Response(`${UTF8_BOM}${buildCsv(rows)}`, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...(truncated ? { 'x-export-truncated': `true; limit=${MAX_ROWS}` } : {}),
    },
  });
}
