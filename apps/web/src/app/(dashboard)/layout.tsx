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
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  return (
    <div className="flex min-h-dvh">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 animate-in fade-in px-4 py-8 duration-300 sm:px-6">
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
