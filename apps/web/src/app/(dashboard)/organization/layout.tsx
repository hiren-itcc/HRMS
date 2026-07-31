'use client';

import { cn } from '@hrms/ui/lib/utils';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/session-provider';

const TABS = [
  { href: '/organization', label: 'Company' },
  { href: '/organization/departments', label: 'Departments' },
  { href: '/organization/designations', label: 'Designations' },
  { href: '/organization/employment-types', label: 'Employment types' },
  { href: '/organization/locations', label: 'Locations' },
  { href: '/organization/shifts', label: 'Shifts' },
  { href: '/organization/holidays', label: 'Holidays' },
];

export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('org.read')) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground/60" aria-hidden />
        <h1 className="font-semibold text-lg">No access</h1>
        <p className="text-muted-foreground text-sm">
          You don't have permission to view organization settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Organization</h1>
        <p className="text-muted-foreground text-sm">
          Company structure, work locations, shifts and holidays
        </p>
      </div>

      <nav
        aria-label="Organization sections"
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <div className="flex w-max gap-1 border-b">
          {TABS.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                  active
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {children}
    </div>
  );
}
