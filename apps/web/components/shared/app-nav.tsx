'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/dashboard', label: 'Forms', icon: Inbox, match: (p: string) => p === '/dashboard' || p.startsWith('/dashboard/forms') },
  { href: '/dashboard/settings', label: 'Billing', icon: CreditCard, match: (p: string) => p.startsWith('/dashboard/settings') },
] as const;

export function AppNav({ orientation = 'vertical' }: { orientation?: 'vertical' | 'horizontal' }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className={cn('flex gap-1', orientation === 'vertical' ? 'flex-col' : 'items-center')}>
      {ITEMS.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
              active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
