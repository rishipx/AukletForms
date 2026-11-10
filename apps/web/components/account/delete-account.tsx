'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, Trash2 } from 'lucide-react';
import { deleteAccountAction } from '@/app/dashboard/settings/actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ActionState } from '@/lib/types';

function SubmitButton({ enabled }: { enabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={!enabled || pending} className="self-start">
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete my account
    </Button>
  );
}

/** Typing the account email enables the button; the server checks it again. */
export function DeleteAccount({ email }: { email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(deleteAccountAction, { ok: false });
  const [typed, setTyped] = useState('');

  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="confirm-delete">
          Type <span className="font-mono">{email}</span> to confirm
        </Label>
        <Input id="confirm-delete" name="confirm" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {state.message ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}
      <SubmitButton enabled={typed.trim().toLowerCase() === email.toLowerCase()} />
    </form>
  );
}
