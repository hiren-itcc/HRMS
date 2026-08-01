'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useSession();
  const reduceMotion = useReducedMotion();

  const tabs = [
    { href: '/attendance', label: 'My attendance', show: true },
    {
      href: '/attendance/team',
      label: 'Team',
      show: can('attendance.read') || can('attendance.read.team'),
    },
    {
      href: '/attendance/approvals',
      label: 'Approvals',
      show: can('attendance.approve') || can('attendance.approve.team'),
    },
  ].filter((t) => t.show);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Clock in and out, review your history and handle corrections"
      />

      {tabs.length > 1 && (
        <nav
          aria-label="Attendance sections"
          className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
        >
          <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
            {tabs.map((tab) => {
              const active = pathname === tab.href;
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'relative isolate whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition-colors duration-150',
                    active
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="attendance-tab-pill"
                      aria-hidden
                      className="-z-10 absolute inset-0 rounded-lg bg-card shadow-sm"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: 'spring', stiffness: 500, damping: 35 }
                      }
                    />
                  )}
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      {children}
    </div>
  );
}
