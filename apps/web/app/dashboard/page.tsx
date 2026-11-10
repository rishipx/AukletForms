import type { Metadata } from 'next';
import Link from 'next/link';
import { Globe, Inbox, Plus, ShieldCheck } from 'lucide-react';
import { CreateFormDialog } from '@/components/forms/create-form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
      <div className="mx-auto mt-16 max-w-md">
        <Card className="text-center">
          <CardHeader className="items-center">
            <div className="mb-2 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
              <Inbox className="size-6" />
            </div>
            <CardTitle className="text-xl">Create your first form</CardTitle>
            <CardDescription>Get an endpoint for your HTML form and have every submission land in your inbox, Slack or Discord.</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateFormDialog>
              <Button size="lg">
                <Plus /> Create New Form
              </Button>
            </CreateFormDialog>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Forms</h1>
          <p className="text-sm text-muted-foreground">
            {forms.length} {forms.length === 1 ? 'form' : 'forms'}
          </p>
        </div>
        <CreateFormDialog />
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {forms.map((form) => {
          const count = form.submissions[0]?.count ?? 0;
          return (
            <li key={form.id}>
              <Link
                href={`/dashboard/forms/${form.id}`}
                className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors group-hover:border-ring/60">
                  <CardHeader>
                    <CardTitle className="truncate text-base">{form.name}</CardTitle>
                    <CardDescription className="truncate">{form.target_email}</CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        <Globe className="size-3" />
                        {form.allowed_domains.length === 0
                          ? 'Any website'
                          : `${form.allowed_domains.length} ${form.allowed_domains.length === 1 ? 'domain' : 'domains'}`}
                      </Badge>
                      {form.enable_turnstile ? (
                        <Badge variant="success">
                          <ShieldCheck className="size-3" /> Turnstile
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="text-muted-foreground">Created {formatDateUtc(form.created_at)}</span>
                      <span className="tabular-nums">
                        <span className="font-semibold">{count.toLocaleString('en-US')}</span>{' '}
                        <span className="text-muted-foreground">{count === 1 ? 'submission' : 'submissions'}</span>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
