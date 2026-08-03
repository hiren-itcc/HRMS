'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { AppHeader } from '@/components/app-header';
import { AppSidebar } from '@/components/app-sidebar';
import { useSession } from '@/components/session-provider';

/**
 * Authenticated shell: fixed dark sidebar (collapsible) + sticky glass
 * header. Client-side guard complements src/proxy.ts — it also catches
 * sessions that die while the tab is open.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status, user } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    /*
     * An account still on the password it was created with goes straight to
     * changing it. The default is shared and therefore guessable; this is what
     * stops that mattering. The profile page itself is exempt, or the redirect
     * would loop on the page that fixes it.
     */
    if (user?.mustChangePassword && !pathname.startsWith('/profile')) {
      router.replace('/profile?changePassword=1');
      return;
    }
    /*
     * A new hire finishes their intake before anything else. The API says the
     * same thing (OnboardingGuard), so this is only about landing them
     * somewhere useful rather than on a wall of 403s — and `/onboarding` is
     * exempt for the same reason `/profile` is above.
     */
    if (user?.employee?.status === 'ONBOARDING' && !pathname.startsWith('/onboarding')) {
      router.replace('/onboarding');
    }
  }, [status, user, router, pathname]);

  return (
    <div className="flex min-h-dvh">
      {/* Without this, reaching page content by keyboard means tabbing the
          whole sidebar on every navigation. */}
      <a
        href="#main"
        className="-translate-y-full sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:translate-y-0 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:font-medium focus:text-sm focus:shadow-overlay focus:ring-[3px] focus:ring-ring/50"
      >
        Skip to content
      </a>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-6xl flex-1 animate-in fade-in px-4 py-8 duration-300 focus:outline-none sm:px-6 print:max-w-none print:p-0"
        >
          {status === 'authenticated' ? (
            children
          ) : (
            <div role="status" className="space-y-4" aria-busy="true" aria-label="Loading">
              <Skeleton className="h-8 w-64" />
              <Skeleton className="h-40 w-full rounded-xl" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
