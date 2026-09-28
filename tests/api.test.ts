import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { closeDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { sha256 } from '@/lib/crypto';
import { createContact } from '@/server/services/crm';
import * as contactsRoute from '@/app/api/v1/contacts/route';
import * as contactRoute from '@/app/api/v1/contacts/[id]/route';
import * as indexRoute from '@/app/api/v1/route';
import * as calendarRoute from '@/app/api/v1/calendar.ics/route';
import { proxy } from '@/proxy';
import { admin, asUser, createFixture, type Fixture } from './helpers';

let f: Fixture;
let contactB: string;
const keys: Record<string, string> = {};

async function makeKey(name: string, subAccountId: string, permissions: string[], revoked = false) {
  const key = `bos_${name}_${'x'.repeat(24)}`;
  const pool = admin();
  try {
    await pool.query(`insert into api_keys (sub_account_id, name, prefix, key_hash, permissions, revoked_at) values ($1, $2, $3, $4, $5, $6)`,
      [subAccountId, name, key.slice(0, 12), sha256(key), permissions, revoked ? new Date() : null]);
  } finally {
    await pool.end();
  }
  return key;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = (handler: (req: Request, r: { params: Promise<any> }) => Promise<Response>, url: string, init: RequestInit & { key?: string } = {}, params: Record<string, string> = {}) =>
  handler(new Request(`http://localhost:3000${url}`, { ...init, headers: { ...(init.key ? { authorization: `Bearer ${init.key}` } : {}), 'content-type': 'application/json', ...(init.headers ?? {}) } }), { params: Promise.resolve(params) });

beforeAll(async () => {
  f = await createFixture();
  await asUser(f.ownerId, f.bizA, async (tx, s) => {
    for (const n of ['Ava Adams', 'Ben Brown', 'Cat Clark']) await createContact(tx, s, { name: n });
  });
  contactB = (await asUser(f.ownerId, f.bizB, (tx, s) => createContact(tx, s, { name: 'Other Business Person' }))).id;
  keys.read = await makeKey('reader', f.bizA, ['contacts.view', 'calendar.view']);
  keys.write = await makeKey('zapier', f.bizA, ['contacts.view', 'contacts.edit']);
  keys.revoked = await makeKey('old', f.bizA, ['contacts.view'], true);
});

afterAll(async () => { await closeDb(); });

describe('REST API v1', () => {
  it('rejects missing, malformed and revoked keys', async () => {
    expect((await call(contactsRoute.GET, '/api/v1/contacts')).status).toBe(401);
    expect((await call(contactsRoute.GET, '/api/v1/contacts', { key: 'bos_not_a_real_key_000000000000' })).status).toBe(401);
    const r = await call(contactsRoute.GET, '/api/v1/contacts', { key: keys.revoked });
    expect(r.status).toBe(401);
    const body = await r.json();
    expect(body.error.code).toBe('unauthorized');
    expect(body.request_id).toBeTruthy();
  });

  it('a key only sees its own business, paginated with a cursor', async () => {
    const r1 = await call(contactsRoute.GET, '/api/v1/contacts?limit=2&sort=created_at', { key: keys.read });
    expect(r1.status).toBe(200);
    const p1 = await r1.json();
    expect(p1.data).toHaveLength(2);
    expect(p1.next_cursor).toBeTruthy();
    const p2 = await (await call(contactsRoute.GET, `/api/v1/contacts?limit=2&sort=created_at&cursor=${p1.next_cursor}`, { key: keys.read })).json();
    const all = [...p1.data, ...p2.data].map((c: { first_name: string }) => c.first_name);
    expect(new Set(all).size).toBe(all.length);
    expect(all).not.toContain('Other');
    const other = await call(contactRoute.GET, `/api/v1/contacts/${contactB}`, { key: keys.read }, { id: contactB });
    expect(other.status).toBe(404);
  });

  it('filters and validates query parameters', async () => {
    const r = await (await call(contactsRoute.GET, '/api/v1/contacts?q=ava', { key: keys.read })).json();
    expect(r.data.map((c: { first_name: string }) => c.first_name)).toEqual(['Ava']);
    expect((await call(contactsRoute.GET, '/api/v1/contacts?sort=password', { key: keys.read })).status).toBe(400);
    expect((await call(contactsRoute.GET, '/api/v1/contacts?limit=5000', { key: keys.read })).status).toBe(400);
  });

  it('a key can only do what its permissions allow', async () => {
    const denied = await call(contactsRoute.POST, '/api/v1/contacts', { method: 'POST', key: keys.read, body: JSON.stringify({ name: 'Nope' }) });
    expect(denied.status).toBe(403);
    expect((await denied.json()).error.code).toBe('forbidden');
  });

  it('creates records, validates bodies and records the key in the audit log', async () => {
    const bad = await call(contactsRoute.POST, '/api/v1/contacts', { method: 'POST', key: keys.write, body: JSON.stringify({ email: 'not-an-email' }) });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details.length).toBeGreaterThan(0);
    const ok = await call(contactsRoute.POST, '/api/v1/contacts', { method: 'POST', key: keys.write, body: JSON.stringify({ name: 'Zara Zapier', email: 'zara@z.test', tags: ['api'] }) });
    expect(ok.status).toBe(201);
    const created = (await ok.json()).data;
    expect(created).toMatchObject({ first_name: 'Zara', last_name: 'Zapier', email: 'zara@z.test', tags: ['api'] });
    const log = await asUser(f.ownerId, f.bizA, (tx) => tx.select().from(auditLog).where(eq(auditLog.entityId, created.id)));
    expect(log[0]).toMatchObject({ action: 'contact.created', actor: 'api', actorLabel: 'zapier' });
    const patched = await call(contactRoute.PATCH, `/api/v1/contacts/${created.id}`, { method: 'PATCH', key: keys.write, body: JSON.stringify({ phone: '0400 000 111' }) }, { id: created.id });
    expect((await patched.json()).data.phone).toBeTruthy();
  });

  it('serves a calendar feed with the key in the URL', async () => {
    const r = await call(calendarRoute.GET, `/api/v1/calendar.ics?key=${keys.read}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('text/calendar');
    expect(await r.text()).toContain('BEGIN:VCALENDAR');
  });

  it('rate limits each key', async () => {
    const key = await makeKey('burst', f.bizA, ['contacts.view']);
    let last = 0;
    for (let i = 0; i < 125; i++) last = (await call(indexRoute.GET, '/api/v1', { key })).status;
    expect(last).toBe(429);
  });
});

describe('web security', () => {
  const req = (path: string, init: { method?: string; headers?: Record<string, string>; cookie?: boolean } = {}) =>
    new NextRequest(`http://localhost:3000${path}`, { method: init.method ?? 'GET', headers: { host: 'localhost:3000', ...(init.cookie ? { cookie: 'bos_session=abc' } : {}), ...(init.headers ?? {}) } });

  it('blocks cross-site POSTs to cookie-authenticated API routes (CSRF)', () => {
    expect(proxy(req('/api/assistant', { method: 'POST', cookie: true, headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(proxy(req('/api/assistant', { method: 'POST', cookie: true })).status).toBe(403);
    expect(proxy(req('/api/assistant', { method: 'POST', cookie: true, headers: { origin: 'http://localhost:3000' } })).status).toBe(200);
    // Webhooks and the token API are exempt (they authenticate differently).
    expect(proxy(req('/api/webhooks/stripe/x', { method: 'POST', headers: { origin: 'https://stripe.com' } })).status).toBe(200);
    expect(proxy(req('/api/v1/contacts', { method: 'POST' })).status).toBe(200);
  });

  it('sends security headers, and only forms may be embedded elsewhere', () => {
    const page = proxy(req('/', { cookie: true }));
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(page.headers.get('content-security-policy')).toMatch(/script-src 'self' 'nonce-/);
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const form = proxy(req('/f/abc123'));
    expect(form.headers.get('content-security-policy')).toContain('frame-ancestors *');
    expect(form.headers.get('x-frame-options')).toBeNull();
  });

  it('sends people without a session to the login page', () => {
    const r = proxy(req('/invoices'));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toContain('/login');
  });
});
