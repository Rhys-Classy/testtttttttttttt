import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { THEME_COOKIE, parseTheme } from '@/lib/theme';
import { PwaRegister } from '@/components/pwa-register';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Business OS', template: '%s · Business OS' },
  description: 'Run every business from one calm place.',
  applicationName: 'Business OS',
  // iPhone: Share → Add to Home Screen opens full screen with this icon.
  appleWebApp: { capable: true, title: 'Business OS', statusBarStyle: 'black' },
  icons: { apple: '/icons/apple-touch-icon.png' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0f1216',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-AU" data-theme={theme}>
      <body className="min-h-dvh">{children}<PwaRegister /></body>
    </html>
  );
}
