'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Trash2 } from 'lucide-react';
import { deleteFormAction, updateFormAction } from '@/app/dashboard/actions';
import { FormSettingsFields } from '@/components/forms/form-fields';
import { Button } from '@/components/ui/button';
import type { ActionState, PublicForm } from '@/lib/types';

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? 'Saving…' : 'Save changes'}
    </Button>
  );
}

function ConfirmDeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" size="sm" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Yes, delete everything
    </Button>
  );
}

function DangerZone({ formId, name }: { formId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-5">
      <div>
        <h3 className="font-semibold text-destructive">Delete this form</h3>
        <p className="text-sm text-muted-foreground">
          Permanently removes <span className="font-medium text-foreground">{name}</span> and all of its submissions. Anything still posting to this endpoint
          will start receiving 404 errors.
        </p>
      </div>
      {confirming ? (
        <form action={deleteFormAction.bind(null, formId)} className="flex items-center gap-2">
          <ConfirmDeleteButton />
          <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </form>
      ) : (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setConfirming(true)}>
          <Trash2 /> Delete form…
        </Button>
      )}
    </section>
  );
}

export function FormSettingsPanel({ form }: { form: PublicForm }) {
  const [state, action] = useActionState<ActionState, FormData>(updateFormAction.bind(null, form.id), { ok: false });

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <form action={action} className="flex flex-col gap-6">
        <FormSettingsFields idPrefix="edit" defaults={form} errors={state.errors ?? {}} />
        <div className="flex items-center gap-4">
          <SaveButton />
          {state.message ? (
            <p role={state.ok ? 'status' : 'alert'} className={state.ok ? 'text-sm text-success' : 'text-sm text-destructive'}>
              {state.message}
            </p>
          ) : null}
        </div>
      </form>
      <DangerZone formId={form.id} name={form.name} />
    </div>
  );
}
