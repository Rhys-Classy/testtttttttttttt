import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/db/client';
import { integrations } from '@/db/schema';
import { decryptJson, encryptJson, maskSecret, randomToken } from '@/lib/crypto';
import { getProvider } from '@/lib/integrations/catalog';
import { parseMoney } from '@/lib/money';
import { Scope, ValidationError, getBusiness, must } from './_common';

export type Integration = typeof integrations.$inferSelect;

/** What the browser may see: config + masked secrets, never the secrets themselves. */
export type PublicIntegration = Omit<Integration, 'secretsEncrypted'> & { secretHints: Record<string, string> };

export function toPublic(row: Integration): PublicIntegration {
  const { secretsEncrypted, ...rest } = row;
  const secrets = decryptJson<Record<string, string>>(secretsEncrypted) ?? {};
  return { ...rest, secretHints: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])) };
}

export async function listBusinessIntegrations(tx: Tx, scope: Scope): Promise<PublicIntegration[]> {
  const rows = await tx.select().from(integrations).where(and(eq(integrations.scope, 'sub_account'), eq(integrations.subAccountId, scope.subAccountId)));
  return rows.map(toPublic);
}

export async function listGlobalIntegrations(tx: Tx): Promise<PublicIntegration[]> {
  const rows = await tx.select().from(integrations).where(eq(integrations.scope, 'global'));
  return rows.map(toPublic);
}

function splitValues(providerId: string, values: Record<string, string>) {
  const def = getProvider(providerId);
  if (!def) throw new ValidationError('Unknown integration.');
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  for (const f of def.fields) {
    const v = (values[f.key] ?? '').trim();
    if (!v) continue;
    if (f.secret) secrets[f.key] = v;
    else config[f.key] = v;
  }
  return { def, config, secrets };
}

/**
 * Connect (or update) a business-level integration. Blank secret fields keep the
 * previously stored value so people can edit config without re-pasting keys.
 */
export async function connectBusinessIntegration(tx: Tx, scope: Scope, providerId: string, values: Record<string, string>) {
  const { def, config, secrets } = splitValues(providerId, values);
  if (def.scope !== 'sub_account') throw new ValidationError(`${def.label} is connected once for the whole account.`);
  const b = await getBusiness(tx, scope.subAccountId);
  const [existing] = await tx.select().from(integrations).where(and(
    eq(integrations.scope, 'sub_account'), eq(integrations.subAccountId, scope.subAccountId), eq(integrations.provider, providerId),
  ));
  const merged = { ...(decryptJson<Record<string, string>>(existing?.secretsEncrypted) ?? {}), ...secrets };
  for (const f of def.fields) {
    if (f.required && !(f.secret ? merged[f.key] : config[f.key])) throw new ValidationError(`${f.label} is required.`);
  }
  if (providerId === 'website' && !config.token) config.token = (existing?.config as Record<string, unknown>)?.token ?? randomToken(18);
  if (providerId === 'google_ads_leads') {
    if (config.dealValue && parseMoney(String(config.dealValue)) == null) throw new ValidationError('Typical job value should be a dollar amount, like 15000.');
    config.key = (existing?.config as Record<string, unknown>)?.key ?? randomToken(18);
  }
  if (providerId === 'stripe' && merged.secretKey && !/^(sk|rk)_(test|live)_/.test(merged.secretKey)) {
    throw new ValidationError('That does not look like a Stripe secret key (sk_… or rk_…).');
  }
  const values2 = {
    config: { ...(existing?.config ?? {}), ...config },
    secretsEncrypted: Object.keys(merged).length ? encryptJson(merged) : null,
    status: 'connected' as const,
    lastError: null,
    connectedAt: existing?.connectedAt ?? new Date(),
    updatedAt: new Date(),
  };
  if (existing) {
    const [row] = await tx.update(integrations).set(values2).where(eq(integrations.id, existing.id)).returning();
    return toPublic(row);
  }
  const [row] = await tx.insert(integrations).values({
    ...values2, accountId: b.accountId, scope: 'sub_account', subAccountId: scope.subAccountId, provider: providerId, label: def.label,
  }).returning();
  return toPublic(row);
}

export async function connectGlobalIntegration(tx: Tx, accountId: string, providerId: string, values: Record<string, string>) {
  const { def, config, secrets } = splitValues(providerId, values);
  if (def.scope !== 'global') throw new ValidationError(`${def.label} is connected per business.`);
  const [existing] = await tx.select().from(integrations).where(and(
    eq(integrations.scope, 'global'), eq(integrations.accountId, accountId), eq(integrations.provider, providerId),
  ));
  const merged = { ...(decryptJson<Record<string, string>>(existing?.secretsEncrypted) ?? {}), ...secrets };
  for (const f of def.fields) {
    if (f.required && !(f.secret ? merged[f.key] : config[f.key])) throw new ValidationError(`${f.label} is required.`);
  }
  const values2 = {
    config: { ...(existing?.config ?? {}), ...config }, secretsEncrypted: encryptJson(merged), status: 'connected' as const,
    lastError: null, connectedAt: existing?.connectedAt ?? new Date(), updatedAt: new Date(),
  };
  if (existing) {
    const [row] = await tx.update(integrations).set(values2).where(eq(integrations.id, existing.id)).returning();
    return toPublic(row);
  }
  const [row] = await tx.insert(integrations).values({ ...values2, accountId, scope: 'global', subAccountId: null, provider: providerId, label: def.label }).returning();
  return toPublic(row);
}

export async function disconnectIntegration(tx: Tx, id: string) {
  const [row] = await tx.update(integrations).set({ status: 'disconnected', secretsEncrypted: null, updatedAt: new Date() })
    .where(eq(integrations.id, id)).returning();
  return must(row, 'Integration');
}

/** SERVER ONLY. Returns decrypted credentials for a connected business integration. */
export async function getBusinessCredentials<T = Record<string, string>>(tx: Tx, scope: Scope, providerIds: string[]) {
  const rows = await tx.select().from(integrations).where(and(
    eq(integrations.scope, 'sub_account'), eq(integrations.subAccountId, scope.subAccountId), eq(integrations.status, 'connected'),
  ));
  for (const id of providerIds) {
    const row = rows.find((r) => r.provider === id);
    if (row) return { integration: row, config: row.config as Record<string, string>, secrets: (decryptJson<T>(row.secretsEncrypted) ?? {}) as T };
  }
  return null;
}

export async function getGlobalCredentials<T = Record<string, string>>(tx: Tx, providerId: string) {
  const [row] = await tx.select().from(integrations).where(and(eq(integrations.scope, 'global'), eq(integrations.provider, providerId), eq(integrations.status, 'connected'))).limit(1);
  if (!row) return null;
  return { integration: row, config: row.config as Record<string, string>, secrets: (decryptJson<T>(row.secretsEncrypted) ?? {}) as T };
}

export async function markIntegrationError(tx: Tx, id: string, message: string) {
  await tx.update(integrations).set({ status: 'error', lastError: message.slice(0, 500), updatedAt: new Date() }).where(eq(integrations.id, id));
}
