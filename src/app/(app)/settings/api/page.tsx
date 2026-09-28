import { desc, inArray } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { apiKeys } from '@/db/schema';
import { env } from '@/lib/env';
import { relativeTime } from '@/lib/dates';
import { grantAllows, PERMISSION_GROUPS, type Permission } from '@/lib/permissions';
import { requireContext } from '@/server/context';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { BusinessBadge } from '@/components/business-badge';
import { EmptyState } from '@/components/ui/empty';
import { NoAccess } from '@/components/no-access';
import { CreateKeyForm, RevokeKey } from './api-bits';

export const metadata = { title: 'API keys' };

export default async function ApiKeysPage() {
  const ctx = await requireContext();
  const manageable = (ctx.current ? [ctx.current] : ctx.businesses).filter((b) => grantAllows(ctx.grants[b.id], 'integrations.manage'));
  if (!manageable.length) return <NoAccess what="API keys" />;
  const keys = await withContext({ actor: 'user', userId: ctx.user.id, subAccountIds: manageable.map((b) => b.id) }, (tx) =>
    tx.select().from(apiKeys).where(inArray(apiKeys.subAccountId, manageable.map((b) => b.id))).orderBy(desc(apiKeys.createdAt)).limit(100));
  const groups = PERMISSION_GROUPS.map((g) => ({ label: g.label, perms: Object.entries(g.perms).map(([key, label]) => ({ key, label })) }));
  const allowedByBusiness = Object.fromEntries(manageable.map((b) => [b.id, groups.flatMap((g) => g.perms.map((p) => p.key)).filter((p) => grantAllows(ctx.grants[b.id], p as Permission))]));
  return (
    <div className="space-y-5">
      <PageHeader title="API keys" subtitle={`For Zapier, your website or other tools. Each key works in one business only. Docs: ${env().APP_URL}/api/v1`} />
      <Card><CardHeader title="Keys" /><CardBody className="divide-y divide-border">
        {keys.length ? keys.map((k) => (
          <div key={k.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{k.name} <span className="font-mono text-xs text-muted">{k.prefix}…</span></p>
              <p className="text-xs text-muted">{k.permissions.length} permissions · {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : 'never used'}{k.expiresAt ? ` · expires ${relativeTime(k.expiresAt)}` : ''}</p>
            </div>
            <BusinessBadge business={ctx.businesses.find((b) => b.id === k.subAccountId)} />
            {k.revokedAt ? <Badge>Revoked</Badge> : k.expiresAt && k.expiresAt < new Date() ? <Badge tone="warn">Expired</Badge> : <RevokeKey id={k.id} />}
          </div>
        )) : <EmptyState title="No API keys yet" body="Create one below when you connect another tool." />}
      </CardBody></Card>
      <Card><CardHeader title="Create a key" subtitle="Give it only what it needs." /><CardBody>
        <CreateKeyForm businesses={manageable.map((b) => ({ id: b.id, name: b.name }))} groups={groups} allowedByBusiness={allowedByBusiness} />
      </CardBody></Card>
    </div>
  );
}
