import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { documents } from '@/db/schema';
import { isUuid } from '@/db/context';
import { getAppContext, readScope } from '@/server/context';
import { storage } from '@/lib/storage';

/** Secure download: the row must be visible to this user under RLS before any bytes are read. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const [doc] = await readScope({ ...ctx, scopeIds: ctx.businesses.map((b) => b.id) }, (tx) => tx.select().from(documents).where(eq(documents.id, id)));
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const data = await storage().get(doc.storageKey);
  const inline = doc.mimeType.startsWith('image/') || doc.mimeType === 'application/pdf';
  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': doc.mimeType,
      'content-length': String(data.length),
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${doc.filename.replace(/["\r\n]/g, '')}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
