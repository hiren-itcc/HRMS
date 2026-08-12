'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@hrms/ui/components/sheet';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { SidebarNav } from '@/components/app-sidebar';
import { BrandMark } from '@/components/brand-mark';
import { CommandPalette } from '@/components/command-palette';
import { IconAction } from '@/components/icon-action';
import { ThemeToggle } from '@/components/theme-toggle';
import { UserMenu } from '@/components/user-menu';
import { NotificationBell } from '@/features/notifications/components/notification-bell';
import { useUiStore } from '@/stores/ui-store';

/** Sticky glass header: mobile nav sheet, sidebar collapse, theme, account. */
export function AppHeader() {
  const { sidebarCollapsed, toggleSidebar } = useUiStore();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="glass sticky top-0 z-40 print:hidden">
      <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          {/* Mobile: slide-over navigation */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            {/*
              No tooltip: `lg:hidden` means this button only exists on screens
              small enough not to have a pointer, and a hover label nobody can
              hover is dead weight. The aria-label is the label here.
            */}
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                />
              }
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
            >
              <SheetHeader className="px-5 pt-5 pb-2">
                <SheetTitle className="flex items-center gap-2.5 text-sidebar-accent-foreground">
                  <BrandMark />
                  HRMS
                </SheetTitle>
                {/* Base UI warns without this on every open. */}
                <SheetDescription className="sr-only">Main navigation</SheetDescription>
              </SheetHeader>
              <div className="py-2">
                <SidebarNav onNavigate={() => setMobileOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>

          {/* Mobile brand (sidebar hidden) */}
          <Link
            href="/dashboard"
            className="flex items-center gap-2 lg:hidden"
            aria-label="HRMS home"
          >
            <span className="font-bold tracking-tight">HRMS</span>
          </Link>

          {/* Desktop: collapse toggle */}
          <IconAction
            label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
            iconClassName="size-4.5"
            className="hidden lg:inline-flex"
            expanded={!sidebarCollapsed}
            onClick={toggleSidebar}
          />
        </div>

        <div className="flex items-center gap-1">
          <CommandPalette />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
