'use client';

import { useRouter } from 'next/navigation';
import { ContactPicker } from '@/components/contact-picker';

export function ComposeToClient() {
  const router = useRouter();
  return <ContactPicker placeholder="Search a contact…" onPick={(h) => h && router.push(`/inbox?contact=${h.id}`)} />;
}
