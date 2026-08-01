'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/page-header';
import { useSession } from '@/components/session-provider';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { can, status } = useSession();
  const reduceMotion = useReducedMotion();

  // Anyone who can administer *something* gets in; each tab gates itself.
  const canEnter =
    can('settings.manage') || can('role.manage') || can('audit.read') || can('org.manage');

  if (status === 'authenticated' && !canEnter) {
    return (
      <div className="flex flex-col items-center gap-2 py-24 text-center">
        <ShieldAlert className="size-10 text-muted-foreground/60" aria-hidden />
        <h1 className="font-semibold text-lg">No access</h1>
        <p className="text-muted-foreground text-sm">
          You don't have permission to view workspace settings.
        </p>
      </div>
    );
  }

  const tabs = [
    { href: '/settings', label: 'Overview', show: true },
    { href: '/settings/preferences', label: 'Preferences', show: can('settings.manage') },
    { href: '/settings/roles', label: 'Roles', show: can('role.manage') },
    { href: '/settings/email', label: 'Email templates', show: can('settings.manage') },
    { href: '/settings/audit', label: 'Audit log', show: can('audit.read') },
  ].filter((t) => t.show);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace configuration, access control and the audit trail"
      />

      <nav
        aria-label="Settings sections"
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
                    layoutId="settings-tab-pill"
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
