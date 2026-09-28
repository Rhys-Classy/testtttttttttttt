import { eq } from 'drizzle-orm';
import { userNotificationPrefs } from '@/db/schema';
import { readScope, requireContext } from '@/server/context';
import { NOTIFICATION_TYPES } from '@/server/services/notifications';
import { saveNotificationPrefsAction } from '@/server/actions/settings';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/action-form';

export const metadata = { title: 'Notification settings' };

export default async function NotificationPrefsPage() {
  const ctx = await requireContext();
  const prefs = await readScope(ctx, (tx) => tx.select().from(userNotificationPrefs).where(eq(userNotificationPrefs.userId, ctx.user.id)));
  const on = (t: string) => prefs.find((p) => p.eventType === t)?.inApp ?? true;
  return (
    <div>
      <PageHeader title="Notifications" subtitle="Fewer, better alerts. Turn off anything that isn’t worth interrupting you for." />
      <Card><CardBody>
        <ActionForm action={saveNotificationPrefsAction} className="space-y-1">
          {NOTIFICATION_TYPES.map((t) => (
            <label key={t.type} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-2">
              <span className="text-sm">{t.label}</span>
              <input type="hidden" name="types" value={t.type} />
              <input type="checkbox" name="inApp" value={t.type} defaultChecked={on(t.type)} className="size-5" />
            </label>
          ))}
          <div className="pt-3"><Button type="submit" variant="primary">Save</Button></div>
        </ActionForm>
      </CardBody></Card>
    </div>
  );
}
