import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { withAnonymous } from '@/db/context';

export async function GET() {
  try {
    await withAnonymous((tx) => tx.execute(sql`select 1`));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
