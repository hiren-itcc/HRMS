import type { OrgSettings, Permission } from '@hrms/shared';
import {
  BarChart3,
  CalendarClock,
  Contact,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Network,
  Palmtree,
  Settings,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perms?: Permission[];
  /** Roadmap module — rendered disabled with a "Soon" chip, never a dead link */
  soon?: boolean;
  /** Hidden when the organization switches this module off in Settings. */
  module?: keyof OrgSettings['modules'];
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/employees',
    label: 'Employees',
    icon: Users,
    perms: ['employee.read', 'employee.read.team'],
  },
  // Open to everyone: looking up a colleague's desk phone is not an HR action.
  { href: '/directory', label: 'Directory', icon: Contact, perms: ['directory.read'] },
  { href: '/organization', label: 'Organization', icon: Network, perms: ['org.read'] },
  { href: '/attendance', label: 'Attendance', icon: CalendarClock, module: 'attendance' },
  { href: '/leave', label: 'Leave', icon: Palmtree, module: 'leave' },
  { href: '/documents', label: 'Documents', icon: FileText, module: 'documents' },
  {
    href: '/payroll',
    label: 'Payroll',
    icon: Wallet,
    // read.own is enough to reach the module: every employee has a salary page.
    perms: ['payroll.read', 'payroll.read.team', 'payroll.read.own'],
    module: 'payroll',
  },
  { href: '/announcements', label: 'Announcements', icon: Megaphone, module: 'announcements' },
  {
    href: '/reports',
    label: 'Reports',
    icon: BarChart3,
    perms: ['report.view', 'report.view.team'],
    module: 'reports',
  },
  {
    href: '/settings',
    label: 'Settings',
    icon: Settings,
    perms: ['settings.manage', 'role.manage', 'audit.read', 'org.manage'],
  },
];
