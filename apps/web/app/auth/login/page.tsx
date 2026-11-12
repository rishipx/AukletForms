import type { Metadata } from 'next';
import { Brand } from '@/components/shared/brand';
import { safeNextPath } from '@/lib/utils';
import { LoginCard } from './login-card';

export const metadata: Metadata = { title: 'Sign in' };

const NOTICES: Record<string, string> = {
  link_invalid: 'That sign-in link is invalid or has expired. Request a new one below.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Brand className="text-lg" />
        <div className="flex flex-1 items-center justify-center py-12">
          <LoginCard next={safeNextPath(next)} notice={error ? (NOTICES[error] ?? null) : null} />
        </div>
      </div>
      <aside className="hidden flex-col justify-center gap-6 bg-primary p-12 text-primary-foreground lg:flex" aria-hidden="true">
        <div className="max-w-md rounded-lg border border-primary-foreground/15 bg-primary-foreground/5 p-5">
          <pre className="overflow-hidden font-mono text-[13px] leading-relaxed opacity-90">
            <code>{'<form action="https://…/v1/f/your-form-id"\n      method="POST">\n  <input name="email">\n  <button>Send</button>\n</form>'}</code>
          </pre>
        </div>
        <div className="max-w-md rounded-lg bg-card p-4 text-card-foreground shadow-xl">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="size-2 animate-live-pulse rounded-full bg-signal" /> New submission
          </div>
          <p className="mt-1 font-mono text-xs text-muted-foreground">email alex@example.com · message Hello from the contact form</p>
        </div>
        <p className="max-w-md text-sm opacity-80">Point a form at Auklet. Every submission is emailed to you and appears here the moment it arrives.</p>
      </aside>
    </main>
  );
}
