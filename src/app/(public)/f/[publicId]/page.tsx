import { notFound, redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { withPublic } from '@/db/context';
import { forms, formSubmissions, subAccounts } from '@/db/schema';
import { resolvePublic } from '@/server/public';
import { submitForm } from '@/server/services/marketing';
import { createDocumentRecord } from '@/server/services/work';
import { friendlyError } from '@/server/actions/_util';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, storage } from '@/lib/storage';
import { rateLimited } from '@/lib/rate-limit';

export const metadata = { robots: { index: false } };

async function submit(publicId: string, fd: FormData) {
  'use server';
  const subAccountId = await resolvePublic('form', publicId);
  if (!subAccountId) notFound();
  if (String(fd.get('company_website_hp') ?? '')) redirect(`/f/${publicId}?sent=1`); // honeypot
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (rateLimited(`form|${publicId}|${ip}`, 10, 10 * 60_000)) redirect(`/f/${publicId}?error=${encodeURIComponent('Too many submissions. Please try again later.')}`);
  let target = `/f/${publicId}?sent=1`;
  try {
    await withPublic(subAccountId, async (tx) => {
      const scope = { subAccountId, userId: null, actor: 'public' as const };
      const [form] = await tx.select().from(forms).where(and(eq(forms.subAccountId, subAccountId), eq(forms.publicId, publicId)));
      if (!form) throw new Error('Form not found');
      const raw: Record<string, unknown> = {};
      const files: { fieldId: string; file: File }[] = [];
      for (const f of form.fields) {
        if (f.type === 'file') { const file = fd.get(f.id); if (file instanceof File && file.size) files.push({ fieldId: f.id, file }); continue; }
        raw[f.id] = f.type === 'checkbox' ? fd.getAll(f.id).map(String) : fd.get(f.id) ?? '';
      }
      for (const { fieldId, file } of files) raw[fieldId] = file.name;
      const { contact, submission } = await submitForm(tx, scope, publicId, raw, { ip: h.get('x-forwarded-for')?.split(',')[0], userAgent: h.get('user-agent')?.slice(0, 200), referrer: h.get('referer') });
      for (const { file } of files) {
        if (file.size > MAX_UPLOAD_BYTES || !ALLOWED_MIME.includes(file.type)) continue;
        const key = await storage().put(subAccountId, file.name, Buffer.from(await file.arrayBuffer()));
        await createDocumentRecord(tx, scope, { entityType: 'contact', entityId: contact.id, contactId: contact.id, filename: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.size, storageKey: key });
      }
      void submission; void formSubmissions;
      if (form.settings.redirectUrl && /^https?:\/\//.test(form.settings.redirectUrl)) target = form.settings.redirectUrl;
    });
  } catch (e) {
    redirect(`/f/${publicId}?error=${encodeURIComponent(friendlyError(e))}`);
  }
  redirect(target);
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ publicId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { publicId } = await params;
  const sp = await searchParams;
  const subAccountId = await resolvePublic('form', publicId);
  if (!subAccountId) notFound();
  const d = await withPublic(subAccountId, async (tx) => ({
    form: (await tx.select().from(forms).where(and(eq(forms.subAccountId, subAccountId), eq(forms.publicId, publicId))))[0],
    business: (await tx.select().from(subAccounts).where(eq(subAccounts.id, subAccountId)))[0],
  }));
  if (!d.form) notFound();
  const { form, business } = d;
  const embed = !!sp.embed;
  const input = 'h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900 focus:border-slate-500 focus:outline-none';
  return (
    <div className={embed ? 'bg-transparent p-2 text-slate-900' : 'min-h-dvh bg-slate-100 px-4 py-8 text-slate-900'}>
      <div className="mx-auto max-w-xl">
        {!embed ? <div className="mb-6 text-center"><p className="text-lg font-semibold">{business.tradingName ?? business.name}</p><h1 className="mt-1 text-2xl font-bold">{form.name}</h1></div> : null}
        {sp.sent ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm"><p className="text-xl font-semibold">Thank you!</p><p className="mt-2 text-slate-600">{form.settings.thankYouMessage || "We've got your details and will be in touch soon."}</p></div>
        ) : (
          <form action={submit.bind(null, publicId)} className="space-y-4 rounded-2xl bg-white p-6 shadow-sm" encType="multipart/form-data">
            {sp.error ? <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{sp.error}</p> : null}
            <input type="text" name="company_website_hp" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
            {form.fields.map((f) => (
              <label key={f.id} className="block">
                {f.type !== 'checkbox' && f.type !== 'radio' ? <span className="mb-1.5 block text-sm font-medium">{f.label}{f.required ? <span className="text-red-600"> *</span> : null}</span> : null}
                {f.type === 'textarea' || f.type === 'address' ? <textarea name={f.id} required={f.required} placeholder={f.placeholder} rows={f.type === 'address' ? 2 : 4} className={`${input} h-auto py-2`} />
                  : f.type === 'dropdown' ? <select name={f.id} required={f.required} className={input} defaultValue=""><option value="" disabled>Choose…</option>{f.options?.filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>
                  : f.type === 'radio' || f.type === 'checkbox' ? (
                    <fieldset><legend className="mb-1.5 text-sm font-medium">{f.label}{f.required ? <span className="text-red-600"> *</span> : null}</legend>
                      <div className="space-y-2">{f.options?.filter(Boolean).map((o) => <label key={o} className="flex items-center gap-2 text-base"><input type={f.type} name={f.id} value={o} className="size-5" required={f.type === 'radio' && f.required} />{o}</label>)}</div>
                    </fieldset>)
                  : f.type === 'file' ? <input type="file" name={f.id} required={f.required} accept="image/*,application/pdf" className="block w-full text-sm" />
                  : <input name={f.id} required={f.required} placeholder={f.placeholder} className={input}
                      type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      autoComplete={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'name' ? 'name' : f.type === 'first_name' ? 'given-name' : f.type === 'last_name' ? 'family-name' : undefined} />}
              </label>
            ))}
            <button className="h-12 w-full rounded-xl text-base font-semibold text-white" style={{ backgroundColor: business.color }}>{form.settings.submitLabel || 'Send'}</button>
            <p className="text-center text-xs text-slate-400">Your details go only to {business.tradingName ?? business.name}.</p>
          </form>
        )}
      </div>
    </div>
  );
}
