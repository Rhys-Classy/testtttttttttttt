import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';
import { withContext } from '@/db/context';
import { getSession } from '@/server/auth';
import { MfaSetup } from '@/components/security/mfa-setup';
import { AuthShell } from '../auth-shell';

export const metadata = { title: 'Set up two-step verification' };

/** Accounts that require two-step verification send people here until it's on. */
export default async function MfaSetupPage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!session.needsMfaSetup) redirect('/');
  const email = await withContext({ actor: 'user', userId: session.userId, subAccountIds: [] }, async (tx) =>
    (await tx.execute<{ email: string }>(sql`select email from users where id = ${session.userId}::uuid`)).rows[0]?.email ?? '');
  return (
    <AuthShell title="Protect your login" subtitle="Your account requires two-step verification.">
      <div className="rounded-3xl border border-border bg-surface p-6"><MfaSetup email={email} onDoneHref="/" /></div>
    </AuthShell>
  );
}
