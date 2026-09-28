import { NextResponse, type NextRequest } from 'next/server';

const PUBLIC = [/^\/login/, /^\/i\//, /^\/q\//, /^\/f\//, /^\/p\//, /^\/api\/webhooks\//, /^\/api\/public\//, /^\/api\/health/];

/** Cheap gate: no session cookie -> login. Real validation happens server-side on every request. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((re) => re.test(pathname))) return NextResponse.next();
  if (!req.cookies.get('bos_session')) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt).*)'],
};
