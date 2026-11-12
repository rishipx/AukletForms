import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe, Plus, ShieldCheck } from 'lucide-react';
import { CreateFormDialog } from '@/components/forms/create-form-dialog';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/shared/page-header';
import { createClient } from '@/lib/supabase/server';
import type { FormListItem } from '@/lib/types';
import { formatDateUtc } from '@/lib/utils';

export const metadata: Metadata = { title: 'Forms' };

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('forms')
    .select('id,name,target_email,allowed_domains,enable_turnstile,created_at,submissions(count)')
    .order('created_at', { ascending: false });

  if (error) throw new Error('Could not load your forms.');
  const forms = (data ?? []) as unknown as FormListItem[];

  if (forms.length === 0) {
    return (
      <div className="flex flex-col gap-8">
        <PageHeader title="Forms" description="Each form gets its own endpoint and its own inbox." />
        <div className="grid gap-8 rounded-xl border bg-card p-6 sm:p-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div className="flex flex-col items-start gap-4">
            <h2 className="text-xl font-semibold">Create your first form</h2>
            <p className="max-w-sm text-sm text-muted-foreground">
              Name it, say where submissions should go, and you get an endpoint to post to. Entries arrive by email, Slack or Discord, and show up here live.
            </p>
            <CreateFormDialog>
              <Button size="lg">
                <Plus /> New form
              </Button>
            </CreateFormDialog>
          </div>
          <div className="min-w-0 rounded-lg border bg-muted/50 p-4" aria-hidden="true">
            <pre className="overflow-hidden font-mono text-[13px] leading-relaxed text-muted-foreground">
              <code>
                {'<form '}
                <span className="text-foreground">{'action="https://…/v1/f/your-form-id"'}</span>
                {'\n      method="POST">\n  <input name="email">\n  <textarea name="message"></textarea>\n  <button>Send</button>\n</form>'}
              </code>
            </pre>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Forms" description={`${forms.length} ${forms.length === 1 ? 'form' : 'forms'}`} actions={<CreateFormDialog />} />

      <ul className="divide-y overflow-hidden rounded-xl border bg-card">
        {forms.map((form) => {
          const count = form.submissions[0]?.count ?? 0;
          const domains = form.allowed_domains.length;
          return (
            <li
              key={form.id}
              className="relative flex flex-col gap-3 px-4 py-4 transition-colors focus-within:bg-muted/60 hover:bg-muted/60 sm:flex-row sm:items-center sm:gap-6 sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <Link
                  href={`/dashboard/forms/${form.id}`}
                  className="block truncate font-medium after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring"
                >
                  {form.name}
                </Link>
                <p className="truncate text-sm text-muted-foreground">{form.target_email}</p>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground sm:w-60">
                <span className="inline-flex items-center gap-1.5">
                  <Globe className="size-3.5" aria-hidden="true" />
                  {domains === 0 ? 'Any website' : `${domains} ${domains === 1 ? 'domain' : 'domains'}`}
                </span>
                {form.enable_turnstile ? (
                  <span className="inline-flex items-center gap-1.5 text-success">
                    <ShieldCheck className="size-3.5" aria-hidden="true" /> Turnstile
                  </span>
                ) : null}
              </div>
              <div className="flex items-baseline justify-between gap-4 sm:w-44 sm:flex-col sm:items-end sm:gap-0.5">
                <span className="text-sm tabular-nums">
                  <span className="font-semibold">{count.toLocaleString('en-US')}</span>{' '}
                  <span className="text-muted-foreground">{count === 1 ? 'submission' : 'submissions'}</span>
                </span>
                <span className="text-xs text-muted-foreground">Created {formatDateUtc(form.created_at)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
