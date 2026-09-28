'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { RotateCcw, TriangleAlert } from 'lucide-react';

/**
 * Something failed while loading this screen. Details are in the server log
 * (search for the reference); the person sees what to do next.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
      <TriangleAlert className="mx-auto size-8 text-warn" />
      <h1 className="mt-3 text-lg font-semibold">This screen didn’t load</h1>
      <p className="mt-1 text-sm text-muted">Nothing was changed. Try again — if it keeps happening, send this reference to support.</p>
      {error.digest ? <p className="mt-3 font-mono text-xs text-muted">Reference {error.digest}</p> : null}
      <div className="mt-5 flex justify-center gap-2">
        <button onClick={reset} className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg"><RotateCcw className="size-4" />Try again</button>
        <Link href="/" className="inline-flex h-11 items-center rounded-xl border border-border px-4 text-sm font-medium">Go home</Link>
      </div>
    </div>
  );
}
