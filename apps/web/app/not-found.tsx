import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">That page doesn&apos;t exist, or you don&apos;t have access to it.</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Back to your forms</Link>
        </Button>
      </div>
    </main>
  );
}
