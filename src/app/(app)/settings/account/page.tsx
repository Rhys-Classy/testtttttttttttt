import { requireContext } from '@/server/context';
import { changePasswordAction } from '@/server/actions/settings';
import { PageHeader } from '@/components/ui/page';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { ActionForm } from '@/components/action-form';

export const metadata = { title: 'My account' };

export default async function AccountPage() {
  const ctx = await requireContext();
  return (
    <div className="space-y-5">
      <PageHeader title="My account" subtitle={`${ctx.user.name} · ${ctx.user.email}`} />
      <Card><CardHeader title="Change password" /><CardBody>
        <ActionForm action={changePasswordAction} resetOnSuccess className="max-w-sm space-y-3">
          <Field label="Current password"><Input name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password"><Input name="next" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <Button type="submit" variant="primary">Change password</Button>
        </ActionForm>
      </CardBody></Card>
      <Card><CardHeader title="Keyboard shortcuts" /><CardBody className="space-y-1 text-sm">
        <p><kbd className="rounded border border-border px-1.5">Ctrl/⌘ K</kbd> command centre — search or say what to do</p>
        <p><kbd className="rounded border border-border px-1.5">/</kbd> open search</p>
        <p><kbd className="rounded border border-border px-1.5">Alt N</kbd> quick add</p>
        <p><kbd className="rounded border border-border px-1.5">Ctrl/⌘ Enter</kbd> send a message in the inbox</p>
      </CardBody></Card>
    </div>
  );
}
