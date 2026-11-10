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
    <main className="grid min-h-screen place-items-center px-4 py-12">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <Brand className="text-xl" />
        <LoginCard next={safeNextPath(next)} notice={error ? (NOTICES[error] ?? null) : null} />
        <p className="text-center text-xs text-muted-foreground">New here? Entering your email creates your account.</p>
      </div>
    </main>
  );
}
