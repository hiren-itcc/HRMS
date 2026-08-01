'use client';

import type { Permission } from '@hrms/shared';
import { cn } from '@hrms/ui/lib/utils';
import {
  Building2,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Clock3,
  IdCard,
  Layers,
  type LucideIcon,
  Mail,
  MapPin,
  Network,
  Palmtree,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import Link from 'next/link';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';

interface SettingsLink {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  perm: Permission;
}

/**
 * Departments, shifts, holidays and leave types are not rebuilt here — they
 * already exist and are the only implementation. Settings surfaces them so
 * there is one place to look, and links out so there is one place to edit.
 */
const ORGANIZATION: SettingsLink[] = [
  {
    href: '/organization',
    label: 'Company profile',
    description: 'Name, timezone and logo',
    icon: Building2,
    perm: 'org.read',
  },
  {
    href: '/organization/departments',
    label: 'Departments',
    description: 'Nested structure and reporting lines',
    icon: Network,
    perm: 'org.read',
  },
  {
    href: '/organization/designations',
    label: 'Designations',
    description: 'Job titles and seniority levels',
    icon: IdCard,
    perm: 'org.read',
  },
  {
    href: '/organization/employment-types',
    label: 'Employment types',
    description: 'Full-time, contract, intern',
    icon: Layers,
    perm: 'org.read',
  },
  {
    href: '/organization/locations',
    label: 'Locations',
    description: 'Branches and their timezones',
    icon: MapPin,
    perm: 'org.read',
  },
  {
    href: '/organization/shifts',
    label: 'Shifts',
    description: 'Working hours and grace periods',
    icon: Clock3,
    perm: 'org.read',
  },
  {
    href: '/organization/holidays',
    label: 'Holiday calendar',
    description: 'Company holidays by location',
    icon: CalendarDays,
    perm: 'org.read',
  },
  {
    href: '/leave/settings',
    label: 'Leave types',
    description: 'Entitlements, carry-forward and balances',
    icon: Palmtree,
    perm: 'leave.manage',
  },
];

const ADMINISTRATION: SettingsLink[] = [
  {
    href: '/settings/preferences',
    label: 'System preferences',
    description: 'Working week, leave year, formats and modules',
    icon: SlidersHorizontal,
    perm: 'settings.manage',
  },
  {
    href: '/settings/roles',
    label: 'Roles & permissions',
    description: 'What each role is allowed to do',
    icon: ShieldCheck,
    perm: 'role.manage',
  },
  {
    href: '/settings/email',
    label: 'Email templates',
    description: 'Subject and body of system emails',
    icon: Mail,
    perm: 'settings.manage',
  },
  {
    href: '/settings/audit',
    label: 'Audit log',
    description: 'Who changed what, and when',
    icon: ScrollText,
    perm: 'audit.read',
  },
];

function LinkCard({ item }: { item: SettingsLink }) {
  const Icon = item.icon;
  const external = !item.href.startsWith('/settings');
  return (
    <Link
      href={item.href}
      className={cn(
        'hover-lift group flex items-start gap-3 rounded-2xl border bg-card p-4 shadow-xs',
        'focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium text-sm">
          {item.label}
          {external && (
            <span className="rounded border px-1 py-0 text-[10px] text-muted-foreground">
              {item.href.startsWith('/leave') ? 'Leave' : 'Organization'}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-muted-foreground text-xs">{item.description}</span>
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </Link>
  );
}

function Section({ title, hint, items }: { title: string; hint: string; items: SettingsLink[] }) {
  if (items.length === 0) return null;
  return (
    <FadeInItem className="space-y-3">
      <div>
        <h2 className="font-semibold text-sm tracking-tight">{title}</h2>
        <p className="text-muted-foreground text-xs">{hint}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <LinkCard key={item.href} item={item} />
        ))}
      </div>
    </FadeInItem>
  );
}

export default function SettingsHubPage() {
  const { can } = useSession();
  const allowed = (items: SettingsLink[]) => items.filter((i) => can(i.perm));

  return (
    <Stagger className="space-y-8">
      <Section
        title="Organization"
        hint="Structure and calendars — these live in their own sections"
        items={allowed(ORGANIZATION)}
      />
      <Section
        title="Administration"
        hint="Workspace-wide configuration and access control"
        items={allowed(ADMINISTRATION)}
      />

      <FadeInItem>
        <p className="flex items-start gap-2 rounded-2xl border bg-muted/40 p-4 text-muted-foreground text-xs">
          <ClipboardList className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Every change made here is recorded in the audit log with who made it and when.
          </span>
        </p>
      </FadeInItem>
    </Stagger>
  );
}
