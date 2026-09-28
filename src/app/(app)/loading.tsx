/** Calm placeholder while a screen loads: same shapes as the real page, no spinners. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-7 w-64" />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-14 rounded-2xl" />)}
      </div>
      <div className="rounded-2xl border border-border bg-surface p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <div className="skeleton size-9 rounded-xl" />
            <div className="flex-1 space-y-2"><div className="skeleton h-3.5 w-1/2" /><div className="skeleton h-3 w-1/3" /></div>
          </div>
        ))}
      </div>
    </div>
  );
}
