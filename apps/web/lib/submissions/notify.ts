import type { NotifyStatus } from '@/lib/types';

export interface NotifyBadge {
  label: string;
  variant: 'destructive' | 'outline';
  /** Plain-language explanation shown as a tooltip and in the submission details. */
  hint: string;
}

/**
 * Only outcomes that need the owner's attention get a badge. "sent", "pending" and
 * unknown (rows from before this feature) show nothing, and spam has its own badge.
 */
export function notifyBadge(status: NotifyStatus | null): NotifyBadge | null {
  switch (status) {
    case 'skipped_cap':
      return {
        label: 'Email skipped',
        variant: 'outline',
        hint: 'The daily email limit was reached, so no email was sent. The submission is saved here and was still relayed to Slack or Discord.',
      };
    case 'failed':
      return {
        label: 'Email failed',
        variant: 'destructive',
        hint: 'The email provider rejected or could not deliver the notification. The submission is saved here.',
      };
    default:
      return null;
  }
}
