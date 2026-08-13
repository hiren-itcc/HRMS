import type { OrgSettings, Permission } from '@hrms/shared';
import {
  BarChart3,
  Boxes,
  CalendarClock,
  Contact,
  DoorOpen,
  FileText,
  FolderKanban,
  LayoutDashboard,
  LifeBuoy,
  type LucideIcon,
  Megaphone,
  Network,
  Palmtree,
  Receipt,
  Settings,
  Target,
  UserSearch,
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
  {
    href: '/recruitment',
    label: 'Recruitment',
    icon: UserSearch,
    // A hiring manager holds only the team read and must still get in — the API
    // narrows them to their own openings once they are there.
    perms: ['recruitment.read', 'recruitment.read.team'],
  },
  {
    href: '/performance',
    label: 'Performance',
    icon: Target,
    // read.own is enough to get in: everybody has their own goals, and the
    // team and cycles tabs gate themselves.
    perms: ['performance.read', 'performance.read.team', 'performance.read.own'],
    module: 'performance',
  },
  {
    href: '/resignations',
    label: 'Exits',
    icon: DoorOpen,
    // Everyone can reach it: the first tab is their own resignation. The
    // approvals and offboarding tabs gate themselves.
    perms: ['resignation.read.own', 'resignation.read.team', 'resignation.read'],
  },
  {
    href: '/assets',
    label: 'Assets',
    icon: Boxes,
    perms: ['asset.read'],
    module: 'assets',
  },
  {
    href: '/expenses',
    label: 'Expenses',
    icon: Receipt,
    // read.own is enough to get in: everybody has their own claims, and the
    // approvals and categories tabs gate themselves.
    perms: ['expense.read', 'expense.read.team', 'expense.read.own'],
    module: 'expenses',
  },
  {
    href: '/helpdesk',
    label: 'Helpdesk',
    icon: LifeBuoy,
    // read.own is enough to get in: everybody can raise a ticket, and the desk
    // and categories tabs gate themselves.
    perms: ['helpdesk.read', 'helpdesk.respond', 'helpdesk.read.own'],
    module: 'helpdesk',
  },
  {
    href: '/projects',
    label: 'Projects',
    icon: FolderKanban,
    // read.own is enough to get in: the register shows what you are on, and the
    // timesheet, approvals and utilisation tabs gate themselves.
    perms: ['project.read', 'project.read.own'],
    module: 'projects',
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
