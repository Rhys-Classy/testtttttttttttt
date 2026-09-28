import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { landingPages } from '@/db/schema';
import { isUuid } from '@/db/context';
import { env } from '@/lib/env';
import { businessById, readScope, requireContext } from '@/server/context';
import { formsByBusiness } from '@/server/queries/page-ctx';
import { deletePageAction } from '@/server/actions/marketing';
import { PageHeader } from '@/components/ui/page';
import { BusinessBadge } from '@/components/business-badge';
import { PageBuilder } from '../page-builder';

export default async function LandingPageEdit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const ctx = await requireContext();
  const [pg] = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => tx.select().from(landingPages).where(eq(landingPages.id, id)));
  if (!pg) notFound();
  const biz = businessById(ctx, pg.subAccountId)!;
  const fb = await formsByBusiness(ctx, [biz.id]);
  return (
    <div>
      <PageHeader title={pg.name} subtitle={<BusinessBadge business={biz} full />} actions={<form action={deletePageAction.bind(null, biz.id, pg.id)}><button className="text-sm text-muted hover:text-danger">Delete</button></form>} />
      <PageBuilder appUrl={env().APP_URL} businesses={[{ id: biz.id, name: biz.name }]} formsBy={fb}
        initial={{ id: pg.id, subAccountId: biz.id, name: pg.name, title: pg.title, sections: pg.sections, style: pg.style as Record<string, string>, published: pg.published, publicId: pg.publicId }} />
    </div>
  );
}
