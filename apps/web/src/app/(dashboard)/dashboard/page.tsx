'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  Clock3,
  DoorOpen,
  LogOut,
  MapPin,
  Network,
  Palmtree,
  UserCheck,
  UserMinus,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';
import { useSession } from '@/components/session-provider';
import { StatCard } from '@/components/stat-card';
import { displayName } from '@/components/user-menu';
import { AnnouncementsWidget } from '@/features/announcements/components/announcements-widget';
import { attendanceApi } from '@/features/attendance/api';
import { ClockCard } from '@/features/attendance/components/clock-card';
import { employeesApi } from '@/features/employees/api';
import { lifecycleApi, lifecycleKeys } from '@/features/lifecycle/api';
import { departmentsApi, holidaysApi, locationsApi } from '@/features/organization/api';
import { HeadcountWidget } from '@/features/reports/components/headcount-widget';

const ONE_PAGE = { page: 1, limit: 1 };

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

const todayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const holidayFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

interface QuickAction {
  href: string;
  label: string;
  hint: string;
  icon: typeof UserRound;
  show: boolean;
}

export default function DashboardPage() {
  const { user, can } = useSession();
  const reduceMotion = useReducedMotion();

  const canEmployees = can('employee.read');
  const canOrg = can('org.read');
  const canTeamAttendance = can('attendance.read') || can('attendance.read.team');

  // Manager/HR dashboards lead with today's attendance; employees see their
  // own clock card instead (rendered above the grid).
  const attendance = useQuery({
    queryKey: ['attendance', 'stats'],
    queryFn: attendanceApi.stats,
    enabled: canTeamAttendance,
    staleTime: 30_000,
  });

  const employees = useQuery({
    queryKey: ['employees', 'stat'],
    queryFn: () => employeesApi.list(ONE_PAGE),
    enabled: canEmployees,
    staleTime: 60_000,
  });
  const departments = useQuery({
    queryKey: ['org-departments', 'stat'],
    queryFn: () => departmentsApi.list(ONE_PAGE),
    enabled: canOrg,
    staleTime: 60_000,
  });
  const locations = useQuery({
    queryKey: ['org-locations', 'stat'],
    queryFn: () => locationsApi.list(ONE_PAGE),
    enabled: canOrg,
    staleTime: 60_000,
  });
  const holidays = useQuery({
    queryKey: ['org-holidays', 'upcoming'],
    queryFn: () =>
      holidaysApi.list({ page: 1, limit: 50, year: new Date().getFullYear(), sort: 'date' }),
    enabled: canOrg,
    staleTime: 60_000,
  });

  /*
   * One query for six lifecycle numbers rather than six list calls reading
   * meta.total off the envelope. Each figure comes back null when the caller
   * may not see it, so the tiles below check for null rather than for a
   * permission — the API decides once and the dashboard follows.
   */
  const lifecycle = useQuery({
    queryKey: lifecycleKeys.stats(),
    queryFn: lifecycleApi.stats,
    staleTime: 60_000,
  });

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = holidays.data?.data.filter((h) => h.date.slice(0, 10) >= today) ?? [];

  if (!user) return null;

  const stats = [
    canTeamAttendance && {
      key: 'present',
      card: (
        <StatCard
          label="Present today"
          value={
            attendance.data ? `${attendance.data.present}/${attendance.data.headcount}` : undefined
          }
          hint={attendance.data ? `${attendance.data.stillIn} still clocked in` : undefined}
          icon={UserCheck}
          gradient="emerald"
          loading={attendance.isLoading}
        />
      ),
    },
    canTeamAttendance && {
      key: 'late',
      card: (
        <StatCard
          label="Late today"
          value={attendance.data?.late}
          hint={attendance.data ? `${attendance.data.notMarked} not marked` : undefined}
          icon={Clock3}
          gradient="amber"
          loading={attendance.isLoading}
        />
      ),
    },
    canEmployees && {
      key: 'employees',
      card: (
        <StatCard
          label="Total employees"
          value={employees.data?.meta.total}
          hint="Active records"
          icon={Users}
          gradient="primary"
          loading={employees.isLoading}
        />
      ),
    },
    canOrg && {
      key: 'departments',
      card: (
        <StatCard
          label="Departments"
          value={departments.data?.meta.total}
          hint="Across the organization"
          icon={Network}
          gradient="sky"
          loading={departments.isLoading}
        />
      ),
    },
    canOrg &&
      !canTeamAttendance && {
        key: 'locations',
        card: (
          <StatCard
            label="Locations"
            value={locations.data?.meta.total}
            hint="Offices & branches"
            icon={MapPin}
            gradient="rose"
            loading={locations.isLoading}
          />
        ),
      },
    lifecycle.data?.pendingResignations !== null && {
      key: 'resignations',
      card: (
        <StatCard
          label="Pending resignations"
          value={lifecycle.data?.pendingResignations ?? undefined}
          hint="Awaiting a decision"
          icon={DoorOpen}
          gradient="rose"
          loading={lifecycle.isLoading}
        />
      ),
    },
    lifecycle.data?.onProbation !== null && {
      key: 'probation',
      card: (
        <StatCard
          label="On probation"
          value={lifecycle.data?.onProbation ?? undefined}
          hint={
            lifecycle.data?.probationOverdue
              ? `${lifecycle.data.probationOverdue} past their end date`
              : `${lifecycle.data?.probationEndingSoon ?? 0} ending within 30 days`
          }
          icon={BadgeCheck}
          gradient="sky"
          loading={lifecycle.isLoading}
        />
      ),
    },
    lifecycle.data?.activeNoticePeriods !== null && {
      key: 'notice',
      card: (
        <StatCard
          label="Serving notice"
          value={lifecycle.data?.activeNoticePeriods ?? undefined}
          hint={
            lifecycle.data?.upcomingLastWorkingDates.length
              ? `Next: ${lifecycle.data.upcomingLastWorkingDates[0]?.name}`
              : 'No upcoming last days'
          }
          icon={LogOut}
          gradient="amber"
          loading={lifecycle.isLoading}
        />
      ),
    },
    lifecycle.data?.offboardingInProgress !== null && {
      key: 'offboarding',
      card: (
        <StatCard
          label="Offboarding"
          value={lifecycle.data?.offboardingInProgress ?? undefined}
          hint="Exits in progress"
          icon={UserMinus}
          gradient="primary"
          loading={lifecycle.isLoading}
        />
      ),
    },
  ].filter(Boolean) as { key: string; card: React.ReactNode }[];

  const actions: QuickAction[] = [
    {
      href: '/attendance',
      label: 'My attendance',
      hint: 'Calendar and corrections',
      icon: CalendarClock,
      show: true,
    },
    {
      href: '/attendance/approvals',
      label: 'Approvals',
      hint: attendance.data?.pendingRequests
        ? `${attendance.data.pendingRequests} awaiting you`
        : 'Attendance corrections',
      icon: Clock3,
      show: can('attendance.approve') || can('attendance.approve.team'),
    },
    {
      href: '/employees/new',
      label: 'Add employee',
      hint: 'Create an HR record',
      icon: UserPlus,
      show: can('employee.create'),
    },
    {
      href: '/employees',
      label: 'Employees',
      hint: 'Browse the directory',
      icon: Users,
      show: can('employee.read') || can('employee.read.team'),
    },
    {
      href: '/organization',
      label: 'Organization',
      hint: 'Structure & settings',
      icon: Building2,
      show: canOrg,
    },
    {
      href: '/profile',
      label: 'My profile',
      hint: 'Account & password',
      icon: UserRound,
      show: true,
    },
  ].filter((a) => a.show);

  // ui-ux-pro-max stagger spec: ~60ms apart, 300–450ms, slight rise + scale
  const item = {
    hidden: reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 },
    show: reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 },
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="sm:text-3xl">
            {greeting()}, {displayName(user)} 👋
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Here's what's happening in your workspace today.
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5 rounded-lg px-3 py-1.5 font-normal">
          <CalendarDays className="size-3.5" aria-hidden />
          {todayFmt.format(new Date())}
        </Badge>
      </div>

      <ClockCard />

      {stats.length > 0 && (
        <motion.div
          className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-4"
          initial="hidden"
          animate="show"
          transition={{ staggerChildren: 0.06 }}
        >
          {stats.map(({ key, card }) => (
            <motion.div key={key} variants={item} transition={{ duration: 0.35, ease: 'easeOut' }}>
              {card}
            </motion.div>
          ))}
        </motion.div>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card className="hover-lift">
          <CardHeader>
            <CardTitle>Quick actions</CardTitle>
            <CardDescription>Jump straight to common tasks</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {actions.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-transform duration-200 group-hover:scale-110">
                  <a.icon className="size-4.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{a.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">{a.hint}</span>
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <AnnouncementsWidget />

        <HeadcountWidget />

        {canOrg && (
          <Card className="hover-lift">
            <CardHeader>
              <CardTitle>Upcoming holidays</CardTitle>
              <CardDescription>From the company holiday calendar</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {holidays.isLoading &&
                [1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-xl" />)}
              {!holidays.isLoading && upcoming.length === 0 && (
                <EmptyState
                  icon={Palmtree}
                  title="No holidays left this year"
                  hint="The rest of the calendar is clear."
                  className="py-8 md:py-8"
                  action={
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href="/organization/holidays" />}
                    >
                      Manage the calendar
                    </Button>
                  }
                />
              )}
              {upcoming.slice(0, 5).map((h) => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 rounded-xl border p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="gradient-primary flex size-9 shrink-0 items-center justify-center rounded-lg text-white">
                      <Palmtree className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-sm">{h.name}</p>
                      <p className="truncate text-muted-foreground text-xs">
                        {h.location?.name ?? 'Entire organization'}
                        {h.isOptional && ' · optional'}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-muted px-2.5 py-1 font-medium text-xs tabular-nums">
                    {holidayFmt.format(new Date(h.date))}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
