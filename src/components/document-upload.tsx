'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Upload } from 'lucide-react';
import { toast } from '@/components/toast';

export function DocumentUpload({ subAccountId, entityType, entityId, contactId, label = 'Upload file or photo' }: { subAccountId: string; entityType: string; entityId?: string | null; contactId?: string | null; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('subAccountId', subAccountId);
      fd.set('entityType', entityType);
      if (entityId) fd.set('entityId', entityId);
      if (contactId) fd.set('contactId', contactId);
      const res = await fetch('/api/documents', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) toast(data.error ?? `Could not upload ${file.name}`, 'error');
    }
    setBusy(false);
    if (ref.current) ref.current.value = '';
    router.refresh();
  };
  return (
    <>
      <input ref={ref} type="file" multiple accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" capture={undefined} className="hidden" onChange={(e) => upload(e.target.files)} />
      <button type="button" onClick={() => ref.current?.click()} disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted hover:border-accent hover:text-accent">
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}{busy ? 'Uploading…' : label}
      </button>
    </>
  );
}
