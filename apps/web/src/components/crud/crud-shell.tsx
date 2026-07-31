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
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
        {onAdd && can(managePerm) && (
          <Button onClick={onAdd}>
            <Plus className="size-4" aria-hidden /> {addLabel}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
