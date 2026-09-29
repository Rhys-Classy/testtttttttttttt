import { readScope, requireContext } from '@/server/context';
import { listBusinessIntegrations, listGlobalIntegrations } from '@/server/services/integrations';
import { CATEGORY_LABELS, PROVIDERS } from '@/lib/integrations/catalog';
import { env } from '@/lib/env';
import { PageHeader } from '@/components/ui/page';
import { PickBusiness } from '@/components/pick-business';
import { IntegrationCard } from './integration-card';

export const metadata = { title: 'Integrations' };

export default async function IntegrationsPage() {
  const ctx = await requireContext();
  const globals = await readScope(ctx, (tx) => listGlobalIntegrations(tx));
  const biz = ctx.current;
  const local = biz ? await readScope(ctx, (tx) => listBusinessIntegrations(tx, { subAccountId: biz.id, userId: ctx.user.id, actor: 'user' })) : [];
  const app = env().APP_URL;
  const webhook = (provider: string, id: string, config: Record<string, unknown>) =>
    provider === 'stripe' ? `${app}/api/webhooks/stripe/${id}` : provider === 'twilio' ? `${app}/api/webhooks/twilio/${id}` : provider === 'website' ? `${app}/api/webhooks/website/${id}?token=${config.token ?? ''}`
      : provider === 'google_ads_leads' ? `${app}/api/webhooks/google-ads/${id}` : null;
  const categories = [...new Set(PROVIDERS.filter((p) => p.scope === 'sub_account').map((p) => p.category))];
  return (
    <div className="space-y-8">
      <PageHeader title="Integrations" subtitle="Each business connects its own Stripe, email, SMS, lead sources and calendars. The AI assistant is shared by the whole account." />
      <section>
        <h2 className="mb-3 text-sm font-semibold">Whole account</h2>
        <div className="space-y-3">
          {PROVIDERS.filter((p) => p.scope === 'global').map((p) => {
            const conn = globals.find((g) => g.provider === p.id) ?? null;
            return <IntegrationCard key={p.id} def={p} scope="global" conn={conn ? { id: conn.id, status: conn.status, config: conn.config, secretHints: conn.secretHints, lastError: conn.lastError } : null} />;
          })}
        </div>
      </section>
      {biz ? categories.map((cat) => (
        <section key={cat}>
          <h2 className="mb-3 text-sm font-semibold">{CATEGORY_LABELS[cat]} · {biz.name}</h2>
          <div className="space-y-3">
            {PROVIDERS.filter((p) => p.scope === 'sub_account' && p.category === cat).map((p) => {
              const conn = local.find((l) => l.provider === p.id) ?? null;
              return <IntegrationCard key={p.id} def={p} scope="sub_account" subAccountId={biz.id} webhookUrl={conn ? webhook(p.id, conn.id, conn.config) : null}
                webhookKey={conn && p.id === 'google_ads_leads' ? String(conn.config.key ?? '') : null}
                conn={conn ? { id: conn.id, status: conn.status, config: conn.config, secretHints: conn.secretHints, lastError: conn.lastError } : null} />;
            })}
          </div>
        </section>
      )) : <PickBusiness ctx={ctx} what="Stripe, email, SMS and calendar connections" />}
    </div>
  );
}
