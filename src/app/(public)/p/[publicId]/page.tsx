import { notFound } from 'next/navigation';
import { and, eq, sql } from 'drizzle-orm';
import type { Metadata } from 'next';
import { withPublic } from '@/db/context';
import { forms, landingPages, subAccounts } from '@/db/schema';
import { resolvePublic } from '@/server/public';

async function load(publicId: string, countView: boolean) {
  const subAccountId = await resolvePublic('landing_page', publicId);
  if (!subAccountId) return null;
  return withPublic(subAccountId, async (tx) => {
    const [pg] = await tx.select().from(landingPages).where(and(eq(landingPages.subAccountId, subAccountId), eq(landingPages.publicId, publicId)));
    if (!pg) return null;
    if (countView) await tx.update(landingPages).set({ views: sql`${landingPages.views} + 1` }).where(and(eq(landingPages.subAccountId, subAccountId), eq(landingPages.id, pg.id)));
    const [business] = await tx.select().from(subAccounts).where(eq(subAccounts.id, subAccountId));
    const fs = await tx.select({ id: forms.id, publicId: forms.publicId }).from(forms).where(eq(forms.subAccountId, subAccountId));
    return { pg, business, forms: fs };
  });
}

export async function generateMetadata({ params }: { params: Promise<{ publicId: string }> }): Promise<Metadata> {
  const d = await load((await params).publicId, false);
  return { title: d?.pg.title ?? 'Page' };
}

const safeHref = (h?: string) => (h && /^(https?:|tel:|mailto:|#|\/)/i.test(h) ? h : '#');
const safeImg = (u?: string) => (u && /^https:\/\//i.test(u) ? u : undefined);

export default async function PublicLandingPage({ params }: { params: Promise<{ publicId: string }> }) {
  const d = await load((await params).publicId, true);
  if (!d) notFound();
  const accent = (d.pg.style as { accent?: string }).accent ?? d.business.color;
  return (
    <main className="min-h-dvh bg-white text-slate-900">
      {d.pg.sections.map((s) => {
        switch (s.type) {
          case 'hero': return (
            <section key={s.id} className="relative px-6 py-20 text-center text-white sm:py-28" style={{ backgroundColor: accent, backgroundImage: safeImg(s.imageUrl) ? `linear-gradient(rgba(0,0,0,.45),rgba(0,0,0,.45)),url(${safeImg(s.imageUrl)})` : undefined, backgroundSize: 'cover', backgroundPosition: 'center' }}>
              <p className="mb-3 text-sm font-medium uppercase tracking-widest opacity-80">{d.business.tradingName ?? d.business.name}</p>
              <h1 className="mx-auto max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">{s.heading}</h1>
              {s.subheading ? <p className="mx-auto mt-4 max-w-2xl text-lg opacity-90">{s.subheading}</p> : null}
              {s.buttonLabel ? <a href={safeHref(s.buttonHref)} className="mt-8 inline-block rounded-xl bg-white px-6 py-3 font-semibold" style={{ color: accent }}>{s.buttonLabel}</a> : null}
            </section>
          );
          case 'heading': return <h2 key={s.id} className="mx-auto max-w-3xl px-6 pt-12 text-3xl font-bold">{s.text}</h2>;
          case 'text': return <p key={s.id} className="mx-auto max-w-3xl whitespace-pre-line px-6 py-4 text-lg leading-relaxed text-slate-700">{s.body}</p>;
          case 'image': return safeImg(s.url) ? <img key={s.id} src={safeImg(s.url)} alt={s.alt ?? ''} className="mx-auto my-6 max-h-[32rem] w-full max-w-4xl rounded-2xl object-cover px-6" /> : null;
          case 'button': return <div key={s.id} className="py-6 text-center"><a href={safeHref(s.href)} className="inline-block rounded-xl px-6 py-3 font-semibold text-white" style={{ backgroundColor: accent }}>{s.label}</a></div>;
          case 'testimonials': return (
            <section key={s.id} className="mx-auto grid max-w-5xl gap-4 px-6 py-12 sm:grid-cols-2 lg:grid-cols-3">
              {s.items.map((t, i) => <blockquote key={i} className="rounded-2xl bg-slate-50 p-6"><p className="text-lg">“{t.quote}”</p><footer className="mt-3 text-sm font-medium text-slate-500">— {t.name}</footer></blockquote>)}
            </section>
          );
          case 'form': {
            const f = d.forms.find((x) => x.id === s.formId);
            return f ? <section key={s.id} id="form" className="bg-slate-50 px-4 py-12"><iframe src={`/f/${f.publicId}?embed=1`} title="Enquiry form" className="mx-auto block h-[720px] w-full max-w-xl border-0" /></section> : null;
          }
        }
      })}
      <footer className="px-6 py-10 text-center text-sm text-slate-400">{d.business.tradingName ?? d.business.name}{d.business.phone ? ` · ${d.business.phone}` : ''}{d.business.abn ? ` · ABN ${d.business.abn}` : ''}</footer>
    </main>
  );
}
