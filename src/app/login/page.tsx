import { redirect } from 'next/navigation';
import { getSession } from '@/server/auth';
import { LoginForm } from './login-form';
import { AuthShell } from './auth-shell';

export const metadata = { title: 'Log in' };

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(session.needsMfaSetup ? '/login/mfa-setup' : '/');
  return (
    <AuthShell title="Welcome back" subtitle="One login for every business.">
      <LoginForm />
    </AuthShell>
  );
}
