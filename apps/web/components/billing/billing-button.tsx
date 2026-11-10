'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button, type ButtonProps } from '@/components/ui/button';

interface BillingButtonProps extends Omit<ButtonProps, 'onClick' | 'children' | 'type'> {
  endpoint: '/api/billing/checkout' | '/api/billing/portal';
  body?: Record<string, string>;
  label: string;
}

/**
 * POSTs to one of our billing routes and sends the browser to the Dodo Payments-hosted
 * page it returns. Errors arrive as RFC 7807 problem details and are shown inline.
 */
export function BillingButton({ endpoint, body, label, ...props }: BillingButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      });
      const data: unknown = await res.json().catch(() => null);
      const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

      if (res.ok && typeof record['url'] === 'string' && record['url'].startsWith('https://')) {
        window.location.assign(record['url']); // leave the spinner on while the browser navigates
        return;
      }
      setError(typeof record['detail'] === 'string' ? record['detail'] : 'Something went wrong. Please try again.');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={onClick} disabled={busy} {...props}>
        {busy ? <Loader2 className="animate-spin" /> : null}
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
