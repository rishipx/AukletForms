'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, MailCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { sendMagicLink, type LoginState } from './actions';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {pending ? 'Sending…' : 'Send Magic Link'}
    </Button>
  );
}

function LoginForm({ next, notice, onReset }: { next: string; notice: string | null; onReset: () => void }) {
  const [state, action] = useActionState<LoginState, FormData>(sendMagicLink, { status: 'idle' });

  if (state.status === 'sent') {
    return (
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mb-2 grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
            <MailCheck className="size-6" />
          </div>
          <CardTitle className="text-xl">Check your inbox</CardTitle>
          <CardDescription>
            We sent a sign-in link to <span className="font-medium text-foreground">{state.email}</span>. Open it in this browser to continue.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center">
          <Button variant="ghost" size="sm" onClick={onReset}>
            Use a different email
          </Button>
        </CardContent>
      </Card>
    );
  }

  const message = state.status === 'error' ? state.message : notice;

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in to Auklet</CardTitle>
        <CardDescription>Enter your email and we&apos;ll send you a magic link. No password needed.</CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

export function LoginCard({ next, notice }: { next: string; notice: string | null }) {
  // Changing the key remounts the form, which clears the "sent" state.
  const [key, setKey] = useState(0);
  return <LoginForm key={key} next={next} notice={notice} onReset={() => setKey((k) => k + 1)} />;
}
