import { desc, sql } from 'drizzle-orm';
import { LayoutTemplate } from 'lucide-react';
import { landingPages } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { Badge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';

export const metadata = { title: 'Landing pages' };

export default async function PagesPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'landing_pages', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Landing pages" business={ctx.current?.name} />;
  const rows = await readScope(ctx, (tx) => tx.select().from(landingPages).where(sql`${landingPages.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(landingPages.updatedAt)));
  return (
    <div>
      <PageHeader title="Landing pages" subtitle="Simple, fast pages for ads and campaigns." actions={<LinkButton href="/pages/new" variant="primary">New page</LinkButton>} />
      {rows.length ? (
        <List>{rows.map((x) => <ListRow key={x.id} href={`/pages/${x.id}`} icon={<LayoutTemplate className="size-5" />} title={x.name}
          meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, x.subAccountId)} /> : null}<Badge tone={x.published ? 'ok' : 'neutral'}>{x.published ? 'Live' : 'Draft'}</Badge><span>/p/{x.publicId}</span></>} right={x.views} rightSub="views" />)}</List>
      ) : <EmptyState title="No pages yet" body="Build a page with a headline, testimonials and your enquiry form in a few minutes." />}
    </div>
  );
}
