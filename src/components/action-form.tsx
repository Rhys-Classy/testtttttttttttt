'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/toast';
import { FormError } from '@/components/ui/form';
import { cn } from '@/lib/cn';

type Result = { ok: true; message?: string } | { ok: false; error: string };

/** A form bound to a server action returning ActionResult: shows errors inline, toasts success, refreshes. */
export function ActionForm({ action, children, className, resetOnSuccess }: { action: (fd: FormData) => Promise<Result>; children: ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null);
      start(async () => {
        setError(null);
        const r = await action(fd);
        if (!r.ok) { setError(r.error); return; }
        toast(r.message ?? 'Saved');
        if (resetOnSuccess) form.reset();
        router.refresh();
      });
    }}>
      {/* The layout class lives on the fieldset so spacing utilities reach the fields. */}
      <fieldset disabled={pending} className={cn('min-w-0', className)}>
        <FormError error={error} />
        {children}
      </fieldset>
    </form>
  );
}
