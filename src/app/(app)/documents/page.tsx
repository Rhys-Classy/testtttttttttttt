import { desc, sql } from 'drizzle-orm';
import { FileText, ImageIcon } from 'lucide-react';
import { documents } from '@/db/schema';
import { pgArray } from '@/db/sql';
import { formatDate } from '@/lib/dates';
import { businessById, readScope, requireContext } from '@/server/context';
import { moduleScope, sp1, type SP } from '@/server/page-helpers';
import { PageHeader } from '@/components/ui/page';
import { List, ListRow } from '@/components/ui/list';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { ModuleOff } from '@/components/module-off';
import { DocumentUpload } from '@/components/document-upload';

export const metadata = { title: 'Documents' };

const LINK: Record<string, true> = { contact: true, job: true, invoice: true, quote: true };

export default async function DocumentsPage({ searchParams }: { searchParams: SP }) {
  const ctx = await requireContext();
  const p = await searchParams;
  const scope = moduleScope(ctx, 'documents', sp1(p.b));
  if (!scope.businesses.length) return <ModuleOff label="Documents" business={ctx.current?.name} />;
  const rows = await readScope(ctx, (tx) => tx.select().from(documents).where(sql`${documents.subAccountId} = any(${pgArray(scope.ids)})`).orderBy(desc(documents.createdAt)).limit(300));
  return (
    <div>
      <PageHeader title="Documents" subtitle="Private files. Only people with access to the business can open them." />
      {ctx.current ? <div className="mb-4"><DocumentUpload subAccountId={ctx.current.id} entityType="business" label="Upload to business files" /></div> : <p className="mb-4 text-sm text-muted">Open a business to upload general files, or upload from a contact or job.</p>}
      {rows.length ? (
        <List>
          {rows.map((d) => (
            <ListRow key={d.id} href={`/api/documents/${d.id}`} icon={d.kind === 'photo' ? <ImageIcon className="size-5" /> : <FileText className="size-5" />} title={d.filename}
              meta={<>{!ctx.current ? <BusinessBadge business={businessById(ctx, d.subAccountId)} /> : null}<span>{formatDate(d.createdAt, ctx.tz)}</span><span>{Math.max(1, Math.round(d.sizeBytes / 1024))} KB</span>{d.entityId && LINK[d.entityType] ? <span>on {d.entityType}</span> : null}</>} />
          ))}
        </List>
      ) : <EmptyState title="No documents yet" body="Upload photos and files on contacts and jobs." />}
    </div>
  );
}
