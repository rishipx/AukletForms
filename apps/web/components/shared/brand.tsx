import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <path
        d="M8 21c0-5.2 3.6-9 8.4-9 2.4 0 4.2.9 5.6 2.4L26 13l-1.6 3.6c.1.5.1 1 .1 1.4 0 3.9-3 6.6-7.2 6.6C12.4 24.6 8 24 8 21Z"
        fill="var(--primary-foreground)"
      />
      <circle cx="19.2" cy="16.2" r="1.3" fill="var(--primary)" />
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-semibold tracking-tight', className)}>
      <LogoMark />
      <span>Auklet</span>
    </span>
  );
}
