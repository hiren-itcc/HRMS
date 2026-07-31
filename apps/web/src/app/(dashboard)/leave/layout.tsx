'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/components/session-provider';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can } = useSession();
  const reduceMotion = useReducedMotion();

  const tabs = [
    { href: '/leave', label: 'My leave', show: true },
    {
      href: '/leave/calendar',
      label: 'Calendar',
      show: true,
    },
    {
      href: '/leave/approvals',
      label: 'Approvals',
      show: can('leave.approve') || can('leave.approve.team'),
    },
    { href: '/leave/settings', label: 'Types & balances', show: can('leave.manage') },
  ].filter((t) => t.show);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-bold text-2xl tracking-tight">Leave</h1>
        <p className="text-muted-foreground text-sm">
          Balances, requests and the company holiday calendar
        </p>
      </div>

      <nav aria-label="Leave sections" className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
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
                    layoutId="leave-tab-pill"
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
