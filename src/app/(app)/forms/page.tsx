import { desc, sql } from 'drizzle-orm';
import { ClipboardList } from 'lucide-react';
import { forms } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { StatusBadge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { LinkButton } from '@/components/ui/button';

export const metadata = { title: 'Forms' };

export default async function FormsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'forms', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Forms" business={ctx.current?.name} noAccess={scope.noAccess} />;
  const rows = await readScope(ctx, (tx) => tx.select().from(forms).where(sql`${forms.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(forms.updatedAt)));
  return (
    <div>
      <PageHeader title="Forms" subtitle="Each form gets a public link you can put on your website, socials or QR code." actions={<LinkButton href="/forms/new" variant="primary">New form</LinkButton>} />
      {rows.length ? (
        <List>
          {rows.map((f) => (
            <ListRow key={f.id} href={`/forms/${f.id}`} icon={<ClipboardList className="size-5" />} title={f.name}
              meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, f.subAccountId)} /> : null}<StatusBadge status={f.status} /><span>{f.fields.length} fields</span><span>/f/{f.publicId}</span></>}
              right={f.submissionCount} rightSub="submissions" />
          ))}
        </List>
      ) : <EmptyState title="No forms yet" body="Make an enquiry form in a minute. Submissions become contacts and leads automatically." />}
    </div>
  );
}
