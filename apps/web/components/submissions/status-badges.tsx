import { Badge } from '@/components/ui/badge';
import { notifyBadge } from '@/lib/submissions/notify';
import type { SubmissionRecord } from '@/lib/types';

/** Spam flag and email outcome for one submission; renders a dash when there is nothing to flag. */
export function StatusBadges({ row }: { row: Pick<SubmissionRecord, 'is_spam' | 'notify_status'> }) {
  const notify = notifyBadge(row.notify_status);
  if (!row.is_spam && notify === null) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.is_spam ? (
        <Badge variant="destructive" title="Flagged as spam (many links). Saved here, but no email was sent.">
          Spam
        </Badge>
      ) : null}
      {notify !== null ? (
        <Badge variant={notify.variant} title={notify.hint}>
          {notify.label}
        </Badge>
      ) : null}
    </div>
  );
}
