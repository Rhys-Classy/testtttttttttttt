import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const control = 'w-full rounded-xl border border-border bg-surface px-3 text-sm placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring/40';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 py-2.5', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'h-11 pr-8', className)} {...props}>{children}</select>;
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function FormError({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>;
}
