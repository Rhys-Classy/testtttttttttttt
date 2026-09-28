import { BusinessDot } from '@/components/business-badge';
import type { AppContext } from '@/server/context';

/** Settings that belong to one business ask you to open that business first. */
export function PickBusiness({ ctx, what }: { ctx: AppContext; what: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-5">
      <p className="font-medium">{what} are set per business.</p>
      <p className="mt-1 text-sm text-muted">Open a business with the switcher (top left), or pick one:</p>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ctx.businesses.map((b) => (
          <form key={b.id} action={async () => { 'use server'; const { switchBusiness } = await import('@/server/actions/shell'); await switchBusiness(b.id); }}>
            <button className="flex w-full items-center gap-2 rounded-xl border border-border px-3 py-3 text-left text-sm hover:bg-surface-2"><BusinessDot color={b.color} />{b.name}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
