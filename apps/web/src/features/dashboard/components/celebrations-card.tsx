'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Cake, PartyPopper } from 'lucide-react';
import { EmployeeAvatar } from '@/components/employee-avatar';
import type { Celebrant, DashboardSummary } from '../api';

/**
 * `"MM-DD"` read as a day and a month, with no year involved at any point.
 *
 * 2000 is a leap year, so 29 February formats rather than rolling over — the
 * year is a formatting scaffold and is never shown.
 */
const dayMonth = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const showMonthDay = (monthDay: string) =>
  dayMonth.format(new Date(`2000-${monthDay}T00:00:00.000Z`));

/** "today", "tomorrow", or the date. Nobody needs "in 0 days". */
function when(inDays: number, monthDay: string): string {
  if (inDays === 0) return 'today';
  if (inDays === 1) return 'tomorrow';
  return showMonthDay(monthDay);
}

/**
 * The API sends one display name rather than two fields, so `initials()` from
 * the employee feature does not fit — it takes first and last separately.
 */
function initialsOf(name: string): string {
  const [first = '', last = ''] = name.split(' ');
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}

function Row({ person, suffix }: { person: Celebrant; suffix?: string }) {
  const soon = person.inDays <= 1;
  return (
    <li className="flex items-center gap-2.5">
      <EmployeeAvatar src={person.avatarUrl} fallback={initialsOf(person.name)} />
      <span className="min-w-0 flex-1 truncate text-sm">
        {person.name}
        {suffix && <span className="text-muted-foreground"> · {suffix}</span>}
      </span>
      <span
        className={
          soon
            ? 'shrink-0 font-medium text-primary text-xs'
            : 'shrink-0 text-muted-foreground text-xs'
        }
      >
        {when(person.inDays, person.monthDay)}
      </span>
    </li>
  );
}

/**
 * Birthdays and work anniversaries in the next 30 days.
 *
 * Visible to everyone on purpose: the point of the panel is that colleagues
 * wish each other well, which does not work if only HR can see it.
 *
 * **No age.** The API sends a day and a month and no year at all, so there is
 * nothing here to derive one from. Anniversaries do show years, because that is
 * the whole substance of one.
 */
export function CelebrationsCard({
  celebrations,
  loading,
}: {
  celebrations: DashboardSummary['celebrations'] | undefined;
  loading: boolean;
}) {
  const birthdays = celebrations?.birthdays ?? [];
  const anniversaries = celebrations?.anniversaries ?? [];
  const nothing = !loading && birthdays.length === 0 && anniversaries.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <PartyPopper className="size-4 text-muted-foreground" aria-hidden />
          Celebrations
        </CardTitle>
        <CardDescription>Birthdays and work anniversaries in the next 30 days</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && <Skeleton className="h-20 w-full rounded-lg" />}

        {nothing && (
          <p className="text-muted-foreground text-sm">Nothing coming up in the next 30 days.</p>
        )}

        {birthdays.length > 0 && (
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">
              <Cake className="size-3.5" aria-hidden /> Birthdays
            </h3>
            <ul className="space-y-2">
              {birthdays.map((person) => (
                <Row key={person.id} person={person} />
              ))}
            </ul>
          </div>
        )}

        {anniversaries.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              Work anniversaries
            </h3>
            <ul className="space-y-2">
              {anniversaries.map((person) => (
                <Row
                  key={person.id}
                  person={person}
                  suffix={`${person.years} year${person.years === 1 ? '' : 's'}`}
                />
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
