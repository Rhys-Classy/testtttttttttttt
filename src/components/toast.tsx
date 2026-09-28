'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, TriangleAlert, X } from 'lucide-react';

type Toast = { id: number; message: string; tone: 'ok' | 'error'; href?: string };

export function toast(message: string, tone: 'ok' | 'error' = 'ok', href?: string) {
  window.dispatchEvent(new CustomEvent('bos:toast', { detail: { message, tone, href } }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent).detail as Omit<Toast, 'id'>;
      const id = Date.now() + Math.random();
      setItems((xs) => [...xs.slice(-2), { ...d, id }]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), d.tone === 'error' ? 7000 : 4000);
    };
    window.addEventListener('bos:toast', onToast);
    return () => window.removeEventListener('bos:toast', onToast);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
          {t.tone === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />}
          <span className="flex-1">{t.message}{t.href ? <a href={t.href} className="ml-2 font-medium text-accent">Open</a> : null}</span>
          <button onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} aria-label="Dismiss" className="text-muted"><X className="size-4" /></button>
        </div>
      ))}
    </div>
  );
}
