'use client';

import type { Permission } from '@hrms/shared';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useSession } from '@/components/session-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';

const ALL_NAV_ITEMS: { href: string; label: string; perms?: Permission[] }[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/employees', label: 'Employees', perms: ['employee.read', 'employee.read.team'] },
  { href: '/organization', label: 'Organization', perms: ['org.read'] },
];

/**
 * Authenticated shell (topbar only for now — the sidebar arrives with the
 * first feature modules). Client-side guard complements src/proxy.ts:
 * it also catches sessions that die while the tab is open.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status, can } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  const NAV_ITEMS = ALL_NAV_ITEMS.filter((item) => !item.perms || item.perms.some((p) => can(p)));

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [status, router, pathname]);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-backdrop-filter:bg-background/60">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-5">
            <Link href="/dashboard" className="flex items-center gap-2" aria-label="HRMS home">
              <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck className="size-4" aria-hidden />
              </span>
              <span className="font-bold tracking-tight">HRMS</span>
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1">
              {NAV_ITEMS.map((item) => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-sm transition-colors',
                      active
                        ? 'bg-accent font-medium text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
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
  );
}
