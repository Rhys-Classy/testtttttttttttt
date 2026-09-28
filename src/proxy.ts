import { NextResponse, type NextRequest } from 'next/server';

/** Reachable without a session: login, customer-facing links, provider webhooks, the token-authenticated API. */
const PUBLIC = [/^\/login/, /^\/i\//, /^\/q\//, /^\/f\//, /^\/p\//, /^\/api\/webhooks\//, /^\/api\/v1(\/|$)/, /^\/api\/health/, /^\/api\/cron\//];
/** Pages other sites may embed in an iframe (enquiry forms). */
const EMBEDDABLE = /^\/f\//;
/** Cookie-authenticated endpoints that change things must come from our own pages (CSRF). */
const NEEDS_SAME_ORIGIN = (path: string) => path.startsWith('/api/') && !path.startsWith('/api/webhooks/') && !path.startsWith('/api/cron/') && !/^\/api\/v1(\/|$)/.test(path);

function contentSecurityPolicy(nonce: string, path: string, isDev: boolean, https: boolean) {
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `font-src 'self' data:`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `frame-src 'self'`,
    `frame-ancestors ${EMBEDDABLE.test(path) ? '*' : "'none'"}`,
    `form-action 'self' https://checkout.stripe.com`,
    `base-uri 'self'`,
    `object-src 'none'`,
    https ? 'upgrade-insecure-requests' : '',
  ].filter(Boolean).join('; ');
}

/**
 * Runs before every page/API request:
 *  1. CSRF: state-changing API calls must carry our own Origin (server actions get the same check from Next).
 *  2. Cheap auth gate: no session cookie -> login. Real validation happens server-side on every request.
 *  3. Security headers, including a per-request nonce Content-Security-Policy.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isDev = process.env.NODE_ENV !== 'production';
  const https = req.nextUrl.protocol === 'https:' || req.headers.get('x-forwarded-proto') === 'https';

  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && NEEDS_SAME_ORIGIN(pathname)) {
    const origin = req.headers.get('origin');
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    let ok = false;
    try { ok = !!origin && !!host && new URL(origin).host === host; } catch { ok = false; }
    if (!ok) return NextResponse.json({ error: 'Cross-site request blocked' }, { status: 403 });
  }

  if (!PUBLIC.some((re) => re.test(pathname)) && !req.cookies.get('bos_session')) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = contentSecurityPolicy(nonce, pathname, isDev, https);
  const requestHeaders = new Headers(req.headers);
  // Next reads the nonce from the request CSP and applies it to its own scripts.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set('content-security-policy', csp);
  res.headers.set('x-content-type-options', 'nosniff');
  res.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  res.headers.set('permissions-policy', 'camera=(self), microphone=(), geolocation=(), payment=(self)');
  res.headers.set('cross-origin-opener-policy', 'same-origin');
  if (!EMBEDDABLE.test(pathname)) res.headers.set('x-frame-options', 'DENY');
  if (https) res.headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  return res;
}

export const config = {
  // Static files for the installable app (icons, manifest, service worker, offline page) skip the proxy.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|offline.html|robots.txt).*)'],
};
