'use client';

import { Badge } from '@hrms/ui/components/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@hrms/ui/components/tooltip';
import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/components/nav-items';
import { useSession } from '@/components/session-provider';
import { useOrgSettings } from '@/features/settings/api';
import { useUiStore } from '@/stores/ui-store';

export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { can } = useSession();
  const settings = useOrgSettings();
  const reduceMotion = useReducedMotion();

  // While settings are loading `modules` is undefined — treat that as "show
  // everything" so the nav never flickers empty on first paint.
  const modules = settings.data?.modules;
  const items = NAV_ITEMS.filter(
    (item) =>
      (!item.perms || item.perms.some((p) => can(p))) &&
      (!item.module || modules === undefined || modules[item.module]),
  );

  return (
    <TooltipProvider delayDuration={0}>
      <nav aria-label="Main" className="flex flex-col gap-1 px-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          if (item.soon) {
            return (
              <span
                key={item.label}
                aria-disabled="true"
                className={cn(
                  'flex cursor-not-allowed items-center gap-3 rounded-xl px-3 py-2 text-sidebar-foreground/45 text-sm',
                  collapsed && 'justify-center px-2',
                )}
              >
                <Icon className="size-4.5 shrink-0" aria-hidden />
                <span className={cn('flex-1', collapsed && 'sr-only')}>{item.label}</span>
                {!collapsed && (
                  <Badge
                    variant="outline"
                    className="border-sidebar-border px-1.5 py-0 text-[10px] text-sidebar-foreground/55"
                  >
                    Soon
                  </Badge>
                )}
              </span>
            );
          }

          const link = (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative isolate flex items-center gap-3 rounded-xl px-3 py-2 font-medium text-sm transition-colors duration-150',
                collapsed && 'justify-center px-2',
                active
                  ? 'text-white'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active-pill"
                  aria-hidden
                  className="gradient-primary -z-10 absolute inset-0 rounded-xl shadow-indigo-500/25 shadow-lg"
                  transition={
                    reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 400, damping: 32 }
                  }
                />
              )}
              <Icon className="size-4.5 shrink-0" aria-hidden />
              {/* Always rendered: when collapsed it is visually hidden rather
                  than removed, so the link keeps its accessible name. The
                  tooltip supplies a description, never the name. */}
              <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
            </Link>
          );

          return collapsed ? (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>{link}</TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>
    </TooltipProvider>
  );
}

/** Fixed desktop sidebar — collapsible to an icon rail; hidden on mobile. */
export function AppSidebar() {
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const { user } = useSession();

  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-sidebar-border border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out lg:flex print:hidden',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <Link
        href="/dashboard"
        className={cn('flex h-16 items-center gap-2.5 px-5', collapsed && 'justify-center px-2')}
        aria-label="HRMS home"
      >
        <span className="gradient-primary flex size-8 shrink-0 items-center justify-center rounded-lg text-white shadow-indigo-500/30 shadow-lg">
          <ShieldCheck className="size-4.5" aria-hidden />
        </span>
        {!collapsed && (
          <span className="font-bold text-lg text-sidebar-accent-foreground tracking-tight">
            HRMS
          </span>
        )}
      </Link>

      <div className="flex-1 overflow-y-auto py-2">
        <SidebarNav collapsed={collapsed} />
      </div>

      {user && !collapsed && (
        <div className="border-sidebar-border border-t px-5 py-4">
          <p className="truncate font-medium text-sidebar-accent-foreground text-sm">
            {user.email}
          </p>
          <p className="truncate text-sidebar-foreground/60 text-xs capitalize">
            {user.roleCode.toLowerCase()}
          </p>
        </div>
      )}
    </aside>
  );
}
