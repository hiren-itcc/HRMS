import { addDays, dateKeyOf, isWeekend, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { OrgFixtures } from './org';
import type { People, SeededPerson } from './people';
import type { Random } from './random';

const WEEKS = 8;

const at = (key: string, hhmm: string) => new Date(`${key}T${hhmm}:00.000Z`);

/** Working-day keys between two offsets from today, oldest first. */
export function workingDays(todayKey: string, fromOffset: number, toOffset: number): string[] {
  const days: string[] = [];
  for (let i = fromOffset; i <= toOffset; i++) {
    const key = addDays(todayKey, i);
    if (!isWeekend(key)) days.push(key);
  }
  return days;
}

/**
 * Eight weeks of days, for everybody who was here to work them.
 *
 * Every derived status has to appear somewhere or the calendar legend is
 * decoration: present, late, half day, work from home, client site, absent
 * (which is the *absence* of a row — ABSENT is derived on read), a day
 * somebody forgot to clock out of, and a day split into two sittings.
 *
 * Returns the remote days per person, because the work-from-home requests
 * seeded next have to agree with them: an approved request behind some of
 * them, and deliberately none behind others, so the "unplanned" flag on the
 * manager's dashboard counts something real.
 */
export async function seedAttendance(
  prisma: PrismaClient,
  orgId: string,
  org: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
) {
  const days = workingDays(todayKey, -(WEEKS * 7) + 1, 0);
  const remoteByEmail = new Map<string, string[]>();

  interface Day {
    key: string;
    person: SeededPerson;
    sessions: { checkIn: Date; checkOut: Date | null }[];
    workMode: 'OFFICE' | 'REMOTE' | 'CLIENT_SITE';
    isLate: boolean;
    status: 'PRESENT' | 'HALF_DAY' | 'WFH';
    note: string | null;
  }

  const seedDays: Day[] = [];

  for (const person of people.staff) {
    const early = person.email === 'rohan@hrms.local';
    const remote: string[] = [];

    for (const key of days) {
      // Nobody has attendance from before their first day.
      if (key < person.joinDate) continue;
      // Asha is left unmarked today so there is a clock-in to press yourself;
      // everybody else is already in, so "Present today" is a real number.
      if (key === todayKey && person.email === 'asha@hrms.local') continue;
      // Somebody serving notice has already stopped coming in after their
      // last working day.
      if (person.exitDate && key > person.exitDate) continue;

      const roll = random.int(0, 99);
      if (roll < 6) continue; // absent — no row at all

      const late = roll < 16;
      const half = roll < 20;
      const wfh = roll < 34;
      const clientSite = roll < 38;
      const split = roll >= 90 && !early;
      const forgotOut = roll >= 86 && roll < 90;

      const workMode = wfh
        ? ('REMOTE' as const)
        : clientSite
          ? ('CLIENT_SITE' as const)
          : ('OFFICE' as const);
      if (wfh) remote.push(key);

      const checkIn = at(key, late ? '10:05' : early ? '07:02' : '09:24');
      const checkOut = at(key, half ? '13:30' : early ? '16:10' : '18:36');
      const sessions = split
        ? [
            { checkIn, checkOut: at(key, '13:12') },
            { checkIn: at(key, '14:06'), checkOut },
          ]
        : [{ checkIn, checkOut: forgotOut ? null : checkOut }];

      seedDays.push({
        key,
        person,
        sessions,
        workMode,
        isLate: late,
        status: half ? 'HALF_DAY' : wfh ? 'WFH' : 'PRESENT',
        note: half ? 'Left early — personal appointment' : null,
      });
    }

    remoteByEmail.set(person.email, remote);
  }

  const minutesOf = (s: { checkIn: Date; checkOut: Date | null }) =>
    s.checkOut ? Math.round((s.checkOut.getTime() - s.checkIn.getTime()) / 60_000) : 0;

  // The record's times are a rollup of its sessions, so they are built that
  // way here too rather than inventing a shape the API never produces.
  await prisma.attendanceRecord.createMany({
    data: seedDays.map((day) => {
      const last = day.sessions[day.sessions.length - 1] as (typeof day.sessions)[number];
      return {
        organizationId: orgId,
        employeeId: day.person.employeeId,
        date: toDate(day.key),
        checkIn: (day.sessions[0] as (typeof day.sessions)[number]).checkIn,
        checkOut: last.checkOut,
        workMinutes: day.sessions.reduce((sum, s) => sum + minutesOf(s), 0),
        isLate: day.isLate,
        status: day.status,
        workMode: day.workMode,
        source: 'WEB' as const,
        note: day.note,
      };
    }),
    skipDuplicates: true,
  });

  // createMany cannot nest children and returns no ids, so sessions are matched
  // back onto their records by the pair that makes a day unique.
  const rows = await prisma.attendanceRecord.findMany({
    where: { organizationId: orgId },
    select: { id: true, employeeId: true, date: true },
  });
  const recordIds = new Map(rows.map((r) => [`${r.employeeId}|${dateKeyOf(r.date)}`, r.id]));

  await prisma.attendanceSession.createMany({
    data: seedDays.flatMap((day) => {
      const recordId = recordIds.get(`${day.person.employeeId}|${day.key}`);
      if (!recordId) return [];
      const office = org.locations.find((l) => l.id === day.person.locationId);
      return day.sessions.map((s) => ({
        recordId,
        checkIn: s.checkIn,
        checkOut: s.checkOut,
        workMode: day.workMode,
        // History that looks like the product made it: a mode always arrives
        // with a verdict, an office day carries the office it was measured
        // against, and a remote day keeps no coordinates at all.
        inVerification: 'VERIFIED' as const,
        outVerification: s.checkOut ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
        ...(day.workMode === 'REMOTE'
          ? {}
          : {
              locationId: day.person.locationId,
              inLatitude: office ? Number(office.latitude) : null,
              inLongitude: office ? Number(office.longitude) : null,
              inAccuracyMeters: random.int(8, 40),
              inDistanceMeters: random.int(5, 120),
            }),
        source: 'WEB' as const,
      }));
    }),
  });

  // ── Corrections: three waiting on a manager, two already decided ───────
  const askers = people.staff.filter((p) => p.role === 'EMPLOYEE').slice(0, 5);
  for (const [i, person] of askers.entries()) {
    const day = addDays(todayKey, -(3 + i * 4));
    const decided = i >= 3;
    await prisma.attendanceRequest.create({
      data: {
        employeeId: person.employeeId,
        date: toDate(day),
        requestedIn: at(day, '09:15'),
        requestedOut: at(day, '18:40'),
        reason: random.pick([
          'Client visit in the morning — could not clock in from the office',
          'Badge reader was down at the office',
          'Laptop battery died before I could clock out',
          'Travelling to the Pune office, forgot to mark it',
        ]),
        status: decided ? (i === 4 ? 'REJECTED' : 'APPROVED') : 'PENDING',
        ...(decided
          ? {
              approverId: people.emp('manager@hrms.local'),
              actedAt: toDate(addDays(todayKey, -2)),
              approverNote:
                i === 4 ? 'No record of a visit that day.' : 'Confirmed with facilities.',
            }
          : {}),
      },
    });
  }

  return { remoteByEmail, recordCount: seedDays.length };
}
