'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { CopyButton } from '@/components/shared/copy-button';
import { notifyBadge } from '@/lib/submissions/notify';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { SubmissionRecord } from '@/lib/types';
import { formatDateTime } from '@/lib/utils';

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm">{children}</dd>
    </div>
  );
}

interface SubmissionSheetProps {
  submission: SubmissionRecord | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<string | null>;
}

export function SubmissionSheet({ submission, onClose, onDelete }: SubmissionSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the delete flow whenever a different submission is opened.
  useEffect(() => {
    setConfirming(false);
    setDeleting(false);
    setError(null);
  }, [submission?.id]);

  const json = submission ? JSON.stringify(submission.payload, null, 2) : '';
  const emailBadge = submission ? notifyBadge(submission.notify_status) : null;

  async function handleDelete() {
    if (!submission) return;
    setDeleting(true);
    const message = await onDelete(submission.id);
    setDeleting(false);
    if (message) {
      setError(message);
      setConfirming(false);
    }
  }

  return (
    <Sheet open={submission !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent>
        {submission ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                Submission {submission.is_spam ? <Badge variant="destructive">Spam</Badge> : null}
                {emailBadge ? <Badge variant={emailBadge.variant}>{emailBadge.label}</Badge> : null}
              </SheetTitle>
              <SheetDescription>
                Received{' '}
                <time dateTime={submission.created_at} suppressHydrationWarning>
                  {formatDateTime(submission.created_at)}
                </time>
              </SheetDescription>
            </SheetHeader>

            <dl className="grid gap-4 sm:grid-cols-2">
              <Meta label="Submitter IP">{submission.submitter_ip ?? '—'}</Meta>
              <Meta label="Submission ID">
                <span className="font-mono text-xs">{submission.id}</span>
              </Meta>
              {emailBadge ? (
                <div className="sm:col-span-2">
                  <Meta label="Email">{emailBadge.hint}</Meta>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <Meta label="User agent">{submission.user_agent ?? '—'}</Meta>
              </div>
            </dl>

            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground">Raw payload</h3>
                <CopyButton text={json} label="Copy JSON" />
              </div>
              <pre
                className="min-h-32 flex-1 overflow-auto rounded-lg border bg-muted/50 p-4 font-mono text-[13px] leading-relaxed"
                tabIndex={0}
                aria-label="Raw JSON payload"
              >
                <code>{json}</code>
              </pre>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4">
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {confirming ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Delete this submission permanently?</span>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
                      {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setConfirming(true)}>
                  <Trash2 /> Delete submission
                </Button>
              )}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
