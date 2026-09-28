import pg from 'pg';
import { eq } from 'drizzle-orm';
import { bootstrapOwner } from './bootstrap';
import { closeDb } from './client';
import { withContext } from './context';
import { ownerDatabaseUrl } from './connection';
import { subAccounts } from './schema';
import { createBusiness, installBusinessDefaults, type BusinessInput } from '@/server/services/businesses';
import type { Scope } from '@/server/services/_common';
import { seedDemoData } from './seed-demo';

/**
 * Starting businesses. These are DATA, not code paths: nothing in the app checks
 * for these names. Add, rename or archive businesses from Settings at any time.
 */
export const STARTER_BUSINESSES: (BusinessInput & { customFields: Parameters<typeof installBusinessDefaults>[3] })[] = [
  {
    name: 'Classy Kitchen Facelifts', shortName: 'CKF', color: '#0f766e', preset: 'trades',
    customFields: [
      { entityType: 'contact', label: 'Kitchen type', fieldType: 'select', options: ['L-shape', 'U-shape', 'Galley', 'Island', 'Single wall'] },
      { entityType: 'contact', label: 'Door profile', fieldType: 'select', options: ['Shaker', 'Flat / slab', 'V-groove', 'Handleless'] },
      { entityType: 'contact', label: 'Benchtop type', fieldType: 'select', options: ['Stone', 'Laminate', 'Timber', 'Keep existing'] },
      { entityType: 'contact', label: 'Splashback', fieldType: 'select', options: ['Glass', 'Tile', 'Stone', 'None'] },
      { entityType: 'job', label: 'Installation date', fieldType: 'date' },
    ],
  },
  {
    name: 'Classy Clothing Co', shortName: 'CCC', color: '#be185d', preset: 'retail',
    customFields: [
      { entityType: 'contact', label: 'Clothing size', fieldType: 'select', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
      { entityType: 'contact', label: 'Preferred style', fieldType: 'text' },
      { entityType: 'contact', label: 'Customer segment', fieldType: 'select', options: ['Retail', 'Wholesale', 'VIP'] },
    ],
  },
  {
    name: 'Madd Marketing & Automations', shortName: 'MMA', color: '#7c3aed', preset: 'agency',
    customFields: [
      { entityType: 'contact', label: 'Monthly ad spend', fieldType: 'number' },
      { entityType: 'contact', label: 'Marketing package', fieldType: 'select', options: ['Starter', 'Growth', 'Automation Pro'] },
      { entityType: 'contact', label: 'Original lead source', fieldType: 'text' },
    ],
  },
  {
    name: 'Gippy Disability Support', shortName: 'GDS', color: '#0369a1', preset: 'care',
    terminology: { contact: 'Client', contacts: 'Clients' },
    customFields: [
      { entityType: 'contact', label: 'Service type', fieldType: 'select', options: ['Core supports', 'Community access', 'Capacity building', 'Respite'] },
      { entityType: 'contact', label: 'Support schedule', fieldType: 'textarea' },
      { entityType: 'contact', label: 'Client preferences', fieldType: 'textarea' },
      { entityType: 'contact', label: 'Plan manager', fieldType: 'text' },
    ],
  },
  {
    name: 'Gippy Custom Furniture', shortName: 'GCF', color: '#b45309', preset: 'custom_manufacturing',
    customFields: [
      { entityType: 'contact', label: 'Timber type', fieldType: 'select', options: ['Blackbutt', 'Spotted gum', 'Tasmanian oak', 'Recycled'] },
      { entityType: 'contact', label: 'Finish', fieldType: 'select', options: ['Natural oil', 'Satin poly', 'Matte lacquer', 'Stained'] },
      { entityType: 'job', label: 'Dimensions', fieldType: 'text' },
      { entityType: 'job', label: 'Delivery requirements', fieldType: 'textarea' },
    ],
  },
];

export async function seed(opts: { demo?: boolean; adminUrl?: string } = {}) {
  const adminUrl = opts.adminUrl ?? ownerDatabaseUrl();
  if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required to seed');
  const email = process.env.SEED_OWNER_EMAIL ?? 'owner@example.com';
  const password = process.env.SEED_OWNER_PASSWORD ?? 'change-me-now';
  const { userId, accountId, createdUser } = await bootstrapOwner(adminUrl, {
    email, password, name: process.env.SEED_OWNER_NAME ?? 'Owner', accountName: process.env.SEED_ACCOUNT_NAME ?? 'My Businesses',
  });

  const created: { id: string; name: string }[] = [];
  for (const b of STARTER_BUSINESSES) {
    const existing = await withContext({ actor: 'user', userId, subAccountIds: [] }, async (tx) =>
      (await tx.select({ id: subAccounts.id, name: subAccounts.name }).from(subAccounts).where(eq(subAccounts.accountId, accountId))).find((s) => s.name === b.name));
    if (existing) continue;
    const row = await withContext({ actor: 'user', userId, subAccountIds: [] }, (tx) => createBusiness(tx, accountId, b));
    await withContext({ actor: 'user', userId, subAccountIds: [row.id] }, async (tx) => {
      const scope: Scope = { subAccountId: row.id, userId, actor: 'user' };
      await installBusinessDefaults(tx, scope, b.preset ?? 'everything', b.customFields);
    });
    created.push({ id: row.id, name: row.name });
  }

  if (opts.demo && created.length) {
    for (const b of created) {
      await withContext({ actor: 'user', userId, subAccountIds: [b.id] }, (tx) =>
        seedDemoData(tx, { subAccountId: b.id, userId, actor: 'user' }, b.name));
    }
    // Demo history shouldn't fire automations or notifications when the worker starts.
    const pool = new pg.Pool({ connectionString: adminUrl, max: 1 });
    await pool.query('update events set processed_at = now() where processed_at is null');
    await pool.end();
  }
  return { email, password: createdUser ? password : '(unchanged)', created: created.map((c) => c.name) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // CLI only: read .env (settings are read lazily, so loading it here is early enough).
  const demo = process.argv.includes('--demo') || process.env.SEED_DEMO === '1';
  import('dotenv')
    .then((d) => { d.config(); return seed({ demo }); })
    .then(async (r) => {
      console.log(`Owner login: ${r.email} / ${r.password}`);
      console.log(r.created.length ? `Created: ${r.created.join(', ')}` : 'Businesses already exist');
      await closeDb();
    })
    .catch(async (e) => {
      console.error(e);
      await closeDb();
      process.exit(1);
    });
}
