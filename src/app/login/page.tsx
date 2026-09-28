import { redirect } from 'next/navigation';
import { getSession, login } from '@/server/auth';
import { LoginForm } from './login-form';

export const metadata = { title: 'Log in' };

async function loginAction(_: unknown, fd: FormData) {
  'use server';
  const res = await login(String(fd.get('email') ?? ''), String(fd.get('password') ?? ''));
  if (!res.ok) return { error: res.error };
  redirect('/');
}

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-accent-fg">B</div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-muted">One login for every business.</p>
        </div>
        <LoginForm action={loginAction} />
      </div>
    </div>
  );
}
