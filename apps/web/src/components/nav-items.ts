import type { Permission } from '@hrms/shared';
import {
  Bell,
  CalendarClock,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Network,
  Palmtree,
  Settings,
  Users,
} from 'lucide-react';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  perms?: Permission[];
  /** Roadmap module — rendered disabled with a "Soon" chip, never a dead link */
  soon?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  {
    href: '/employees',
    label: 'Employees',
    icon: Users,
    perms: ['employee.read', 'employee.read.team'],
  },
  { href: '/organization', label: 'Organization', icon: Network, perms: ['org.read'] },
  { href: '/attendance', label: 'Attendance', icon: CalendarClock },
  { href: '/leave', label: 'Leave', icon: Palmtree },
  { href: '/documents', label: 'Documents', icon: FileText },
  { href: '/announcements', label: 'Announcements', icon: Megaphone },
  { href: '#reports', label: 'Reports', icon: Bell, soon: true },
  { href: '#settings', label: 'Settings', icon: Settings, soon: true },
];
