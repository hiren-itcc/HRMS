'use client';

import { Badge } from '@hrms/ui/components/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { CalendarClock, FileText, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/components/session-provider';
import { displayName } from '@/components/user-menu';

const upcoming = [
  { icon: CalendarClock, label: 'Attendance & check-in', detail: 'Sprint 4' },
  { icon: FileText, label: 'Leave requests', detail: 'Sprint 5' },
];

export default function DashboardPage() {
  const { user } = useSession();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-bold text-2xl tracking-tight">Welcome, {displayName(user)}</h1>
          <p className="text-muted-foreground text-sm">Here's your workspace</p>
        </div>
        <Badge variant="secondary">{user.roleCode}</Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="transition-shadow hover:shadow-sm">
          <Link href="/profile" className="block focus-visible:outline-hidden">
            <CardHeader>
              <UserRound className="size-5 text-info" aria-hidden />
              <CardTitle className="text-base">My profile</CardTitle>
              <CardDescription>Account details, role and password</CardDescription>
            </CardHeader>
          </Link>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Coming next</CardTitle>
            <CardDescription>Modules land per the roadmap</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {upcoming.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="flex items-center gap-2 text-sm">
                <Icon className="size-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">{label}</span>
                <span className="text-muted-foreground text-xs">{detail}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
