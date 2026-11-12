'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { sendMagicLink, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? 'Sending…' : 'Send sign-in link'}
    </Button>
  );
}

function LoginForm({ next, notice, onReset }: { next: string; notice: string | null; onReset: () => void }) {
  const [state, action] = useActionState<LoginState, FormData>(sendMagicLink, { status: 'idle' });

  if (state.status === 'sent') {
    return (
      <div className="flex w-full max-w-sm flex-col gap-4" role="status">
        <div className="grid size-11 place-items-center rounded-lg bg-accent text-accent-foreground">
          <MailCheck className="size-5" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{state.email}</span>. Open it in this browser to continue.
        </p>
        <Button variant="ghost" size="sm" className="w-fit -ml-3" onClick={onReset}>
          Use a different email
        </Button>
      </div>
    );
  }

  const message = state.status === 'error' ? state.message : notice;

  return (
    <div className="flex w-full max-w-sm flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">Sign in to Auklet</h1>
        <p className="text-sm text-muted-foreground">Enter your email and we&apos;ll send you a sign-in link. New here? That creates your account.</p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            required
            autoFocus
            aria-invalid={message ? true : undefined}
          />
        </div>
        {message ? (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        ) : null}
        <SubmitButton />
      </form>
    </div>
  );
}

export function LoginCard({ next, notice }: { next: string; notice: string | null }) {
  // Changing the key remounts the form, which clears the "sent" state.
  const [key, setKey] = useState(0);
  return <LoginForm key={key} next={next} notice={notice} onReset={() => setKey((k) => k + 1)} />;
}
