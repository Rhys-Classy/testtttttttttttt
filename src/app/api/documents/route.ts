import { NextResponse } from 'next/server';
import { getAppContext, inBusiness } from '@/server/context';
import { createDocumentRecord } from '@/server/services/work';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, storage } from '@/lib/storage';
import { friendlyError } from '@/server/actions/_util';
import { isUuid } from '@/db/context';

const ENTITY_TYPES = ['business', 'contact', 'company', 'deal', 'job', 'invoice', 'quote'] as const;

/** Upload. The business is re-checked by RLS when the document row is inserted. */
export async function POST(req: Request) {
  const ctx = await getAppContext();
  if (!ctx) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  const fd = await req.formData();
  const file = fd.get('file');
  const subAccountId = String(fd.get('subAccountId') ?? '');
  const entityType = String(fd.get('entityType') ?? 'business') as (typeof ENTITY_TYPES)[number];
  const entityId = String(fd.get('entityId') ?? '') || null;
  const contactId = String(fd.get('contactId') ?? '') || null;
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!ENTITY_TYPES.includes(entityType) || (entityId && !isUuid(entityId)) || (contactId && !isUuid(contactId))) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: 'Files must be under 25 MB.' }, { status: 400 });
  if (!ALLOWED_MIME.includes(file.type)) return NextResponse.json({ error: 'PDF, images and Office documents only.' }, { status: 400 });
  try {
    const doc = await inBusiness(ctx, subAccountId, async (tx, s) => {
      const key = await storage().put(s.subAccountId, file.name, Buffer.from(await file.arrayBuffer()));
      return createDocumentRecord(tx, s, { entityType, entityId, contactId, filename: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.size, storageKey: key });
    });
    return NextResponse.json({ ok: true, id: doc.id });
  } catch (e) {
    return NextResponse.json({ error: friendlyError(e) }, { status: 400 });
  }
}
