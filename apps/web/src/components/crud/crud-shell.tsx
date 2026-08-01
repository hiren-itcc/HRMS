'use client';

import type { Permission } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSession } from '@/components/session-provider';

interface CrudShellProps {
  title: string;
  description: string;
  search: string;
  onSearchChange: (q: string) => void;
  onAdd?: () => void;
  addLabel?: string;
  /** Permission required to see the add button */
  managePerm?: Permission;
  /** Extra filter controls rendered next to search */
  filters?: React.ReactNode;
  /**
   * `h1` when this shell IS the page heading (a route with no section layout
   * above it, e.g. /employees). `h2` when a layout already supplied the h1.
   */
  headingLevel?: 'h1' | 'h2';
  children: React.ReactNode;
}

/** Standard list-page chrome: header, debounced search, filters, add button. */
export function CrudShell({
  title,
  description,
  search,
  onSearchChange,
  onAdd,
  addLabel = 'Add',
  managePerm = 'org.manage',
  filters,
  headingLevel: Heading = 'h2',
  children,
}: CrudShellProps) {
  const { can } = useSession();
  const [value, setValue] = useState(search);

  // Debounce keystrokes → URL (300ms), keep in sync on back/forward
  useEffect(() => setValue(search), [search]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (value !== search) onSearchChange(value);
    }, 300);
    return () => clearTimeout(t);
  }, [value, search, onSearchChange]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Heading>{title}</Heading>
          <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
        </div>
        {onAdd && can(managePerm) && (
          <Button onClick={onAdd}>
            <Plus className="size-4" aria-hidden /> {addLabel}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 [&>*]:min-w-0 [&>[data-slot=select-trigger]]:w-full [&>[data-slot=select-trigger]]:flex-1 sm:[&>[data-slot=select-trigger]]:w-auto sm:[&>[data-slot=select-trigger]]:flex-none">
        <div className="relative w-full max-w-xs">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Search…"
            className="pl-9"
            aria-label={`Search ${title.toLowerCase()}`}
          />
        </div>
        {filters}
      </div>

      {children}
    </section>
  );
}
