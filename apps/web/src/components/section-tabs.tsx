'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface SectionTab {
  href: string;
  label: string;
  /** Omit for always-visible tabs; pass a permission check result to gate one. */
  show?: boolean;
}

/**
 * Section navigation for a module's sub-routes.
 *
 * Deliberately NOT coss `Tabs`: that is Base UI's tab primitive and emits
 * role="tablist"/role="tab", which promises a screen-reader user that
 * activating it swaps a panel in place. These navigate. A <nav> of links
 * carrying aria-current="page" is what a route switcher actually is, so the
 * coss look is borrowed while the semantics stay honest.
 *
 * Five module layouts each had their own copy of this, differing only in the
 * layoutId string.
 */
export function SectionTabs({
  tabs,
  label,
  id,
}: {
  tabs: SectionTab[];
  label: string;
  id: string;
}) {
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const visible = tabs.filter((tab) => tab.show !== false);

  return (
    <nav
      aria-label={label}
      className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 print:hidden"
    >
      <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
        {visible.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative isolate whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
                active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId={id}
                  aria-hidden
                  className="-z-10 absolute inset-0 rounded-lg bg-card shadow-sm"
                  transition={
                    reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }
                  }
                />
              )}
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
