import { type NextRequest, NextResponse } from 'next/server';

/**
 * UX-only route protection (docs/09-nextjs-architecture.md §auth):
 * checks a non-httpOnly session *marker* cookie set by the web app on
 * login/logout. The real security boundary is the API (guards + RBAC) —
 * the httpOnly refresh cookie itself is scoped to the API and invisible here.
 */
export const SESSION_MARKER_COOKIE = 'hrms_session';

const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password', '/invite'];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));
  const hasSession = request.cookies.has(SESSION_MARKER_COOKIE);

  if (!isPublic && !hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  if (isPublic && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets and Next internals. The root page is
  // public until the (dashboard) shell lands in Sprint 2.
  matcher: [
    '/dashboard/:path*',
    '/profile/:path*',
    '/organization/:path*',
    '/employees/:path*',
    '/attendance/:path*',
    '/leave/:path*',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/invite',
  ],
};
