import { redirect } from 'next/navigation';
import { pendingMfaUser } from '@/server/auth';
import { AuthShell } from '../auth-shell';
import { VerifyForm } from './verify-form';

export const metadata = { title: 'Two-step verification' };

export default async function VerifyPage() {
  if (!(await pendingMfaUser())) redirect('/login');
  return (
    <AuthShell title="Enter your code" subtitle="Open your authenticator app and type the 6-digit code.">
      <VerifyForm />
    </AuthShell>
  );
}
