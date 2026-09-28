import 'server-only';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { Tx } from '@/db/client';
import { withAnonymous, withContext } from '@/db/context';
import { sha256 } from '@/lib/crypto';
import type { Permission } from '@/lib/permissions';
import { rateLimited } from '@/lib/rate-limit';
import { ForbiddenError, NotFoundError, ValidationError, type Scope } from '@/server/services/_common';
import { logError } from '@/server/actions/_util';

/**
 * REST API v1: token-authenticated, one business per key.
 *
 *   Authorization: Bearer bos_…
 *
 * Every request: key → business (SECURITY DEFINER lookup) → rate limit →
 * permission check against the key's own list → work runs pinned to that one
 * business, attributed to the key in the audit log.
 */
export type ApiKey = { id: string; subAccountId: string; name: string; permissions: string[] };
export type ApiCtx = { tx: Tx; scope: Scope; key: ApiKey; requestId: string };

const RATE_LIMIT = 120; // requests per minute per key

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) {
    super(message);
  }
}

function json(status: number, body: unknown, requestId: string, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { 'x-request-id': requestId, 'cache-control': 'no-store', ...extra } });
}

function errorBody(code: string, message: string, requestId: string, details?: unknown) {
  return { error: { code, message, ...(details ? { details } : {}) }, request_id: requestId };
}

export async function authenticate(req: Request, allowQueryKey = false): Promise<ApiKey | null> {
  const header = req.headers.get('authorization') ?? '';
  let token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (!token && allowQueryKey) token = new URL(req.url).searchParams.get('key') ?? '';
  if (!/^bos_[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const row = await withAnonymous(async (tx) =>
    (await tx.execute<{ id: string; sub_account_id: string; name: string; permissions: string[] }>(sql`select * from app.auth_api_key(${sha256(token)})`)).rows[0]);
  return row ? { id: row.id, subAccountId: row.sub_account_id, name: row.name, permissions: row.permissions } : null;
}

/** Wrap a route handler: auth, rate limit, permission, pinned context, consistent errors. */
export function apiRoute<P = Record<string, string>>(
  perm: Permission | null,
  handler: (req: Request, c: ApiCtx, params: P) => Promise<{ status?: number; body: unknown; raw?: Response }>,
  opts: { allowQueryKey?: boolean } = {},
) {
  return async (req: Request, route: { params: Promise<P> }): Promise<Response> => {
    const requestId = randomBytes(6).toString('hex');
    try {
      const key = await authenticate(req, opts.allowQueryKey);
      if (!key) return json(401, errorBody('unauthorized', 'Missing or invalid API key. Send "Authorization: Bearer <key>".', requestId), requestId, { 'www-authenticate': 'Bearer' });
      if (rateLimited(`api|${key.id}`, RATE_LIMIT, 60_000)) return json(429, errorBody('rate_limited', `Slow down: ${RATE_LIMIT} requests per minute per key.`, requestId), requestId, { 'retry-after': '60' });
      if (perm && !key.permissions.includes(perm)) return json(403, errorBody('forbidden', `This key doesn't have the "${perm}" permission.`, requestId), requestId);
      const params = await route.params;
      const res: { status?: number; body: unknown; raw?: Response } = await withContext(
        { actor: 'system', subAccountId: key.subAccountId, auditActor: 'api', label: key.name },
        (tx) => handler(req, { tx, scope: { subAccountId: key.subAccountId, userId: null, actor: 'system' }, key, requestId }, params),
      );
      if (res.raw) return res.raw;
      return json(res.status ?? 200, res.body, requestId);
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, errorBody(e.code, e.message, requestId, e.details), requestId);
      if (e instanceof z.ZodError) return json(400, errorBody('invalid_request', 'Some fields are missing or invalid.', requestId, e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))), requestId);
      if (e instanceof ValidationError) return json(400, errorBody('invalid_request', e.message, requestId), requestId);
      if (e instanceof NotFoundError) return json(404, errorBody('not_found', e.message, requestId), requestId);
      if (e instanceof ForbiddenError) return json(403, errorBody('forbidden', e.message, requestId), requestId);
      const code = (e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code;
      if (code === '23505') return json(409, errorBody('conflict', 'That already exists.', requestId), requestId);
      if (code === '23503') return json(400, errorBody('invalid_reference', 'A referenced record does not exist in this business.', requestId), requestId);
      logError(requestId, e, `api ${req.method} ${new URL(req.url).pathname}`);
      return json(500, errorBody('server_error', 'Something went wrong. Nothing was saved. Quote the request_id if you contact support.', requestId), requestId);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Pagination / sorting                                                */
/* ------------------------------------------------------------------ */

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
  sort: z.string().max(40).optional(),
});

export function parseQuery<T extends z.ZodTypeAny>(req: Request, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}

export function body<T extends z.ZodTypeAny>(schema: T, req: Request): Promise<z.infer<T>> {
  return req.json().catch(() => { throw new ApiError(400, 'invalid_json', 'Body must be JSON.'); }).then((b) => schema.parse(b));
}

type SortSpec = { column: PgColumn; kind: 'date' | 'text' };

/**
 * Keyset pagination: `sort` is a whitelisted column name, "-" prefix for descending
 * (default "-created_at"). The cursor encodes the last row's sort value and id.
 */
export function keyset(sorts: Record<string, SortSpec>, idCol: PgColumn, sortParam: string | undefined, cursor: string | undefined) {
  const desc = !sortParam || sortParam.startsWith('-');
  const name = (sortParam ?? '-created_at').replace(/^-/, '');
  const spec = sorts[name];
  if (!spec) throw new ApiError(400, 'invalid_sort', `Sort by one of: ${Object.keys(sorts).flatMap((k) => [k, `-${k}`]).join(', ')}`);
  // Postgres keeps microseconds, JavaScript dates keep milliseconds: compare and order at millisecond precision.
  const col = spec.kind === 'date' ? sql`date_trunc('milliseconds', ${spec.column})` : sql`${spec.column}`;
  let where: SQL | undefined;
  if (cursor) {
    let c: { v: string; id: string };
    try { c = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); } catch { throw new ApiError(400, 'invalid_cursor', 'That cursor is not valid.'); }
    if (!c || typeof c.id !== 'string' || !z.string().uuid().safeParse(c.id).success) throw new ApiError(400, 'invalid_cursor', 'That cursor is not valid.');
    const v = spec.kind === 'date' ? sql`${c.v}::timestamptz` : sql`${c.v}`;
    where = desc ? sql`(${col}, ${idCol}) < (${v}, ${c.id}::uuid)` : sql`(${col}, ${idCol}) > (${v}, ${c.id}::uuid)`;
  }
  const order = desc ? [sql`${col} desc`, sql`${idCol} desc`] : [sql`${col} asc`, sql`${idCol} asc`];
  const next = <R extends { id: string }>(rows: R[], limit: number, value: (r: R) => Date | string) => {
    if (rows.length <= limit) return { rows, nextCursor: null as string | null };
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const v = value(last);
    return { rows: page, nextCursor: Buffer.from(JSON.stringify({ v: v instanceof Date ? v.toISOString() : v, id: last.id })).toString('base64url') };
  };
  return { where, order, next, name };
}

export const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
