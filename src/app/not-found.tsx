import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-accent">404</p>
        <h1 className="mt-2 text-xl font-semibold">That page isn’t here</h1>
        <p className="mt-1 text-sm text-muted">It may have been deleted, or it belongs to a business you can’t open.</p>
        <Link href="/" className="mt-5 inline-flex h-11 items-center rounded-xl bg-accent px-4 text-sm font-medium text-accent-fg">Go home</Link>
      </div>
    </div>
  );
}
