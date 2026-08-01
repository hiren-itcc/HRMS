'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/reports', label: 'Employees' },
  { href: '/reports/attendance', label: 'Attendance' },
  { href: '/reports/leave', label: 'Leave' },
  { href: '/reports/departments', label: 'Departments' },
];

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();

  return (
    <div className="space-y-6">
      <div className="print:hidden">
        <h1 className="font-bold text-2xl tracking-tight">Reports</h1>
        <p className="text-muted-foreground text-sm">
          Headcount, attendance, leave and department analytics
        </p>
      </div>

      <nav
        aria-label="Report sections"
        className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 print:hidden"
      >
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {TABS.map((tab) => {
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
                    layoutId="reports-tab-pill"
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

      {children}
    </div>
  );
}
