import { can, type AppContext } from '@/server/context';
import { listAudit } from '@/server/queries/audit';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { AuditList } from './audit-list';

/** "History" card on a record page. Only for people allowed to read the audit log. */
export async function RecordHistory({ ctx, entityId, subAccountId }: { ctx: AppContext; entityId: string; subAccountId: string }) {
  if (!can(ctx, 'audit.view', subAccountId)) return null;
  const { rows } = await listAudit({ ...ctx, current: null, scopeIds: [subAccountId] }, { entityId, limit: 20 });
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title="History" subtitle="Changes to this record" />
      <CardBody><AuditList rows={rows} tz={ctx.tz} businesses={ctx.businesses} /></CardBody>
    </Card>
  );
}
