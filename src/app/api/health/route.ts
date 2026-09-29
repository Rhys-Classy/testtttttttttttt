import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withAnonymous } from '@/db/context';

/** Liveness + database check. On failure returns only an error class/code (no hosts or secrets); details go to the server log. */
export async function GET() {
  try {
    await withAnonymous((tx) => tx.execute(sql`select 1`));
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as { code?: string; name?: string; message?: string; cause?: { code?: string; message?: string } };
    console.error(JSON.stringify({ level: 'error', context: 'health', message: err.message, code: err.code ?? err.cause?.code, cause: err.cause?.message }));
    const reason = err.cause?.code ?? err.code ?? (/APP_DB_PASSWORD|No database configured/.test(err.message ?? '') ? 'config' : err.name ?? 'error');
    return NextResponse.json({ ok: false, reason }, { status: 503 });
  }
}
