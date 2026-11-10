'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, Inbox, Loader2 } from 'lucide-react';
import { SubmissionSheet } from '@/components/submissions/submission-sheet';
import { StatusBadges } from '@/components/submissions/status-badges';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { summarizePayload } from '@/lib/submissions/payload';
import { createClient } from '@/lib/supabase/client';
import { SUBMISSION_COLUMNS, type SubmissionRecord } from '@/lib/types';
import { cn, formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 50;

interface SubmissionsTableProps {
  formId: string;
  initialRows: SubmissionRecord[];
  initialTotal: number;
}

export function SubmissionsTable({ formId, initialRows, initialTotal }: SubmissionsTableProps) {
  const [rows, setRows] = useState<SubmissionRecord[]>(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [selected, setSelected] = useState<SubmissionRecord | null>(null);
  const [live, setLive] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Live updates: new submissions appear at the top without a refresh.
  // Realtime evaluates the table's RLS policy, so only this user's rows arrive.
  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    let teardown: (() => void) | undefined;

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await supabase.realtime.setAuth(data.session?.access_token ?? null);
      if (cancelled) return;

      const channel = supabase
        .channel(`submissions:${formId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'submissions', filter: `form_id=eq.${formId}` }, (payload) => {
          const row = payload.new as SubmissionRecord;
          setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [row, ...prev]));
          setTotal((t) => t + 1);
        })
        // The Worker records the email outcome (sent / failed) a moment after the insert.
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'submissions', filter: `form_id=eq.${formId}` }, (payload) => {
          const row = payload.new as SubmissionRecord;
          setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...row } : r)));
        })
        .subscribe((status) => setLive(status === 'SUBSCRIBED'));

      teardown = () => {
        void supabase.removeChannel(channel);
      };
    })();

    return () => {
      cancelled = true;
      teardown?.();
    };
  }, [formId]);

  const loadMore = useCallback(async () => {
    const last = rows[rows.length - 1];
    if (!last) return;
    setLoadingMore(true);
    setLoadError(null);
    const { data, error } = await createClient()
      .from('submissions')
      .select(SUBMISSION_COLUMNS)
      .eq('form_id', formId)
      .lt('created_at', last.created_at)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);
    setLoadingMore(false);
    if (error) {
      setLoadError('Could not load more submissions.');
      return;
    }
    const older = (data ?? []) as unknown as SubmissionRecord[];
    setRows((prev) => {
      const known = new Set(prev.map((r) => r.id));
      return [...prev, ...older.filter((r) => !known.has(r.id))];
    });
  }, [rows, formId]);

  const deleteSubmission = useCallback(async (id: string): Promise<string | null> => {
    // RLS only lets owners delete; `select` lets us detect "0 rows deleted".
    const { data, error } = await createClient().from('submissions').delete().eq('id', id).select('id');
    if (error || !data || data.length === 0) return 'Could not delete this submission. Please try again.';
    setRows((prev) => prev.filter((r) => r.id !== id));
    setTotal((t) => Math.max(0, t - 1));
    setSelected(null);
    return null;
  }, []);

  const hasMore = rows.length < total;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="tabular-nums">
            <span className="font-semibold text-foreground">{total.toLocaleString('en-US')}</span> {total === 1 ? 'submission' : 'submissions'}
          </span>
          <span
            className="inline-flex items-center gap-1.5"
            title={live ? 'New submissions appear here automatically' : 'Live updates are connecting or unavailable'}
          >
            <span className={cn('size-2 rounded-full', live ? 'bg-success' : 'bg-muted-foreground/40')} aria-hidden="true" />
            {live ? 'Live' : 'Offline'}
          </span>
        </div>
        <Button asChild variant="outline" size="sm">
          <a href={`/dashboard/forms/${formId}/export`} download>
            <Download /> Export to CSV
          </a>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-16 text-center">
          <Inbox className="size-8 text-muted-foreground" />
          <p className="font-medium">No submissions yet</p>
          <p className="max-w-xs text-sm text-muted-foreground">Send a test from the Integration tab. It will show up here the moment it arrives.</p>
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-48">Timestamp</TableHead>
                <TableHead>Key fields</TableHead>
                <TableHead className="w-32">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const summary = summarizePayload(row.payload);
                return (
                  <TableRow
                    key={row.id}
                    tabIndex={0}
                    role="button"
                    aria-label={`Inspect submission from ${formatDateTime(row.created_at)}`}
                    onClick={() => setSelected(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelected(row);
                      }
                    }}
                    className="cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                  >
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      <time dateTime={row.created_at} suppressHydrationWarning>
                        {formatDateTime(row.created_at)}
                      </time>
                    </TableCell>
                    <TableCell>
                      {summary.length === 0 ? (
                        <span className="text-muted-foreground">(empty)</span>
                      ) : (
                        <div className="flex flex-col gap-0.5">
                          {summary.map((f) => (
                            <span key={f.key} className="max-w-xl truncate">
                              <span className="font-medium">{f.key}:</span> <span className="text-muted-foreground">{f.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadges row={row} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {hasMore ? (
        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? <Loader2 className="animate-spin" /> : null} Load more
          </Button>
          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : null}
        </div>
      ) : null}

      <SubmissionSheet submission={selected} onClose={() => setSelected(null)} onDelete={deleteSubmission} />
    </div>
  );
}
