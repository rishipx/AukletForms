import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { FormSettingsPanel } from '@/components/forms/form-settings-panel';
import { FormTabs, type FormTab } from '@/components/forms/form-tabs';
import { IntegrationSnippets } from '@/components/forms/integration-snippets';
import { PageHeader } from '@/components/shared/page-header';
import { SubmissionsTable } from '@/components/submissions/submissions-table';
import { formEndpoint } from '@/lib/config/env';
import { createClient } from '@/lib/supabase/server';
import { SUBMISSION_COLUMNS, type FormRecord, type PublicForm, type SubmissionRecord } from '@/lib/types';
import { UUID_RE } from '@/lib/utils';

const PAGE_SIZE = 50;

function toTab(value: string | undefined): FormTab {
  return value === 'integration' || value === 'settings' ? value : 'submissions';
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID_RE.test(id)) return { title: 'Form' };
  const supabase = await createClient();
  const { data } = await supabase.from('forms').select('name').eq('id', id).maybeSingle();
  return { title: (data as { name: string } | null)?.name ?? 'Form' };
}

export default async function FormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  if (!UUID_RE.test(id)) notFound();

  const supabase = await createClient();
  // RLS means a form that belongs to someone else simply comes back as "no rows".
  const { data: formData, error: formError } = await supabase.from('forms').select('*').eq('id', id).maybeSingle();
  if (formError) throw new Error('Could not load this form.');
  if (!formData) notFound();
  // The stored (encrypted) Turnstile secret stays on the server: the browser only learns whether one exists.
  const { turnstile_secret_key: storedSecret, ...rest } = formData as unknown as FormRecord;
  const form: PublicForm = { ...rest, has_turnstile_secret: typeof storedSecret === 'string' && storedSecret !== '' };

  const {
    data: rowData,
    count,
    error: rowsError,
  } = await supabase
    .from('submissions')
    .select(SUBMISSION_COLUMNS, { count: 'exact' })
    .eq('form_id', id)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (rowsError) throw new Error('Could not load submissions.');
  const rows = (rowData ?? []) as unknown as SubmissionRecord[];

  const endpoint = formEndpoint(form.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard" className="inline-flex w-fit items-center gap-1 rounded text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden="true" /> All forms
        </Link>
        <PageHeader
          title={form.name}
          description={
            <>
              Submissions are emailed to <span className="font-medium text-foreground">{form.target_email}</span>
            </>
          }
        />
      </div>

      <FormTabs
        defaultTab={toTab(tab)}
        submissions={<SubmissionsTable formId={form.id} initialRows={rows} initialTotal={count ?? rows.length} />}
        integration={<IntegrationSnippets endpoint={endpoint} turnstile={form.enable_turnstile} />}
        settings={<FormSettingsPanel form={form} />}
      />
    </div>
  );
}
