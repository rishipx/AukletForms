'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Plus } from 'lucide-react';
import { createFormAction } from '@/app/dashboard/actions';
import { FormSettingsFields } from '@/components/forms/form-fields';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import type { ActionState } from '@/lib/types';

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? 'Creating…' : 'Create form'}
    </Button>
  );
}

function CreateFormBody() {
  const [state, action] = useActionState<ActionState, FormData>(createFormAction, { ok: false });
  return (
    <form action={action} className="flex flex-col gap-6">
      <FormSettingsFields idPrefix="create" errors={state.errors ?? {}} />
      {state.message && !state.ok ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            Cancel
          </Button>
        </DialogClose>
        <CreateButton />
      </div>
    </form>
  );
}

export function CreateFormDialog({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <Plus /> New form
          </Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Form</DialogTitle>
          <DialogDescription>You&apos;ll get a unique endpoint to point your HTML form or fetch call at.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open so every opening starts with fresh state. */}
        {open ? <CreateFormBody /> : null}
      </DialogContent>
    </Dialog>
  );
}
