import Link from 'next/link';
import { SearchX } from 'lucide-react';

export default function AppNotFound() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
      <SearchX className="mx-auto size-8 text-muted" />
      <h1 className="mt-3 text-lg font-semibold">Not found</h1>
      <p className="mt-1 text-sm text-muted">It may have been deleted, or it belongs to a business your role can’t see.</p>
      <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg">Go home</Link>
    </div>
  );
}
