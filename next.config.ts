import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Docker/self-host uses the standalone server; Netlify's Next.js runtime packages the app itself.
  output: process.env.NETLIFY ? undefined : 'standalone',
  serverExternalPackages: ['pg', 'nodemailer', '@netlify/database'],
  poweredByHeader: false,
};

export default nextConfig;
