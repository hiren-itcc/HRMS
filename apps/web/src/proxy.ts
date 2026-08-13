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

  // The root is a signpost, never a page: signed in goes to the dashboard,
  // signed out goes to sign-in.
  if (pathname === '/') {
    return NextResponse.redirect(new URL(hasSession ? '/dashboard' : '/login', request.url));
  }

  if (!isPublic && !hasSession) {
    const url = new URL('/login', request.url);
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  /*
   * `/invite` is exempt from the signed-in bounce. Somebody arriving with a
   * stale session cookie and a spent link needs to be told "this link has
   * already been used" — bouncing them to the dashboard answers a question
   * they did not ask.
   */
  if (isPublic && hasSession && !pathname.startsWith('/invite')) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  return NextResponse.next();
}

export const config = {
  // Everything except static assets and Next internals.
  matcher: [
    '/',
    '/dashboard/:path*',
    '/profile/:path*',
    '/organization/:path*',
    '/employees/:path*',
    '/directory/:path*',
    '/attendance/:path*',
    '/leave/:path*',
    '/documents/:path*',
    '/letters/:path*',
    '/onboarding/:path*',
    '/announcements/:path*',
    '/reports/:path*',
    '/settings/:path*',
    /*
     * Each of these shipped after the matcher was written, and the list had
     * quietly stopped matching the comment above it — so an unauthenticated
     * visit to /payroll or /assets rendered an empty shell whose every request
     * then 401'd, rather than landing on sign-in.
     *
     * Not a security hole — this file is UX only, and the API is the real
     * boundary — but the failure mode is a blank page instead of a login form.
     *
     * Deliberately not counted in this comment any more. It said "these five"
     * and there were then six, which is a footnote nobody remembers to update
     * and a small lie every time a module ships.
     */
    '/payroll/:path*',
    '/recruitment/:path*',
    '/resignations/:path*',
    '/assets/:path*',
    '/expenses/:path*',
    '/performance/:path*',
    '/projects/:path*',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/invite',
    /*
     * `/careers` is deliberately absent. It is the one part of the web app
     * meant to be read by somebody with no account, so it must not be matched
     * at all: adding it to PUBLIC_PATHS instead would bounce any signed-in
     * visitor to the dashboard, which is not what a link to a job advert
     * should do.
     */
  ],
};
