import { addDays, dateKeyOf, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import type { OrgFixtures } from './org';
import {
  BANKS,
  FIRST_NAMES_F,
  FIRST_NAMES_M,
  LAST_NAMES,
  type Random,
  RELATIONS,
  STREETS,
} from './random';

type Status = 'ACTIVE' | 'ONBOARDING' | 'ON_NOTICE' | 'EXITED';
type RoleCode = 'ADMIN' | 'HR' | 'FINANCE' | 'MANAGER' | 'EMPLOYEE';
type Structure = 'STD' | 'LEAD' | 'CONTRACT';

export interface SeededPerson {
  employeeId: string;
  userId: string;
  email: string;
  code: string;
  firstName: string;
  lastName: string;
  status: Status;
  role: RoleCode;
  joinDate: string;
  exitDate: string | null;
  departmentId: string;
  departmentName: string;
  locationId: string;
  designation: string;
  structure: Structure;
  monthlyCtc: number;
  monthlyTds: number;
  managerEmail: string | null;
}

export interface People {
  all: SeededPerson[];
  /** Everybody an attendance calendar makes sense for: not gone, not pending. */
  staff: SeededPerson[];
  byEmail(email: string): SeededPerson;
  emp(email: string): string;
  usr(email: string): string;
}

interface Spec {
  email: string;
  role: RoleCode;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE';
  dob: string;
  joinDate: string;
  status: Status;
  exitDate?: string;
  departmentKey: keyof OrgFixtures['departments'];
  designation: string;
  locationName: string;
  shift: string;
  employmentType: string;
  structure: Structure;
  monthlyCtc: number;
  managerEmail: string | null;
  probationEndDate?: string;
  confirmedOn?: string;
  remoteDaysPerWeek?: number;
  noticePeriodDays?: number;
}

/** 29 Feb only exists every fourth year; a birth date on it will not parse. */
const safeMonthDay = (key: string) => (key.slice(5) === '02-29' ? '02-28' : key.slice(5));

/**
 * The workforce.
 *
 * Seven named logins keep the emails they have always had, so muscle memory
 * survives a re-seed. The other twenty-one are generated, which is what makes
 * a list paginate, a department chart look like a company and an attrition
 * percentage mean something.
 *
 * Statuses are spread on purpose. Everybody used to be ACTIVE, which left the
 * probation tile, the leaving tile and every status filter with nothing to
 * show — the screens looked broken when they were merely empty.
 */
export async function seedPeople(
  prisma: PrismaClient,
  orgId: string,
  org: OrgFixtures,
  roles: Record<string, string>,
  passwordHash: string,
  random: Random,
  todayKey: string,
): Promise<People> {
  const year = Number(todayKey.slice(0, 4));
  const d = org.departments;

  const specs: Spec[] = [
    {
      email: 'admin@hrms.local',
      role: 'ADMIN',
      firstName: 'Aarav',
      lastName: 'Shah',
      gender: 'MALE',
      dob: '1984-04-12',
      joinDate: `${year - 6}-01-15`,
      status: 'ACTIVE',
      departmentKey: 'peopleOps',
      designation: 'Chief Executive Officer',
      locationName: 'Ahmedabad',
      shift: 'General',
      employmentType: 'FT',
      structure: 'LEAD',
      monthlyCtc: 350_000,
      managerEmail: null,
    },
    {
      email: 'hr@hrms.local',
      role: 'HR',
      firstName: 'Priya',
      lastName: 'Nair',
      gender: 'FEMALE',
      dob: '1990-09-03',
      joinDate: `${year - 4}-06-01`,
      status: 'ACTIVE',
      departmentKey: 'peopleOps',
      designation: 'HR Manager',
      locationName: 'Ahmedabad',
      shift: 'General',
      employmentType: 'FT',
      structure: 'LEAD',
      monthlyCtc: 145_000,
      managerEmail: 'admin@hrms.local',
    },
    {
      email: 'finance@hrms.local',
      role: 'FINANCE',
      firstName: 'Vikram',
      lastName: 'Rao',
      gender: 'MALE',
      dob: '1986-02-19',
      joinDate: `${year - 3}-07-01`,
      status: 'ACTIVE',
      departmentKey: 'finance',
      designation: 'Finance Manager',
      locationName: 'Ahmedabad',
      shift: 'General',
      employmentType: 'FT',
      structure: 'LEAD',
      monthlyCtc: 155_000,
      managerEmail: 'admin@hrms.local',
    },
    {
      email: 'manager@hrms.local',
      role: 'MANAGER',
      firstName: 'Meera',
      lastName: 'Iyer',
      gender: 'FEMALE',
      dob: '1988-12-21',
      joinDate: `${year - 5}-03-10`,
      status: 'ACTIVE',
      departmentKey: 'engineering',
      designation: 'Engineering Manager',
      locationName: 'Ahmedabad',
      shift: 'General',
      employmentType: 'FT',
      structure: 'STD',
      monthlyCtc: 175_000,
      managerEmail: 'admin@hrms.local',
    },
    {
      email: 'asha@hrms.local',
      role: 'EMPLOYEE',
      firstName: 'Asha',
      lastName: 'Verma',
      gender: 'FEMALE',
      dob: '1996-02-17',
      joinDate: `${year - 2}-07-05`,
      status: 'ACTIVE',
      departmentKey: 'platform',
      designation: 'Senior Software Engineer',
      locationName: 'Ahmedabad',
      shift: 'General',
      employmentType: 'FT',
      structure: 'STD',
      monthlyCtc: 92_000,
      managerEmail: 'manager@hrms.local',
    },
    {
      email: 'rohan@hrms.local',
      role: 'EMPLOYEE',
      firstName: 'Rohan',
      lastName: 'Desai',
      gender: 'MALE',
      dob: '1998-06-30',
      joinDate: `${year - 1}-02-20`,
      status: 'ACTIVE',
      departmentKey: 'platform',
      designation: 'Software Engineer',
      locationName: 'Pune',
      shift: 'Early',
      employmentType: 'FT',
      structure: 'STD',
      monthlyCtc: 68_000,
      managerEmail: 'manager@hrms.local',
      // Two days a week is the org default; this one is a standing exception,
      // so the per-employee override has a live example behind it.
      remoteDaysPerWeek: 4,
    },
    {
      email: 'zara@hrms.local',
      role: 'EMPLOYEE',
      firstName: 'Zara',
      lastName: 'Khan',
      gender: 'FEMALE',
      dob: '2000-11-08',
      joinDate: `${year}-01-08`,
      status: 'ACTIVE',
      departmentKey: 'sales',
      designation: 'Sales Executive',
      locationName: 'Pune',
      shift: 'General',
      employmentType: 'CT',
      structure: 'CONTRACT',
      monthlyCtc: 34_000,
      managerEmail: 'hr@hrms.local',
      // Joined this year, still unconfirmed: the probation badge in the flesh.
      probationEndDate: `${year}-07-08`,
    },
  ];

  // ── The generated twenty-one ───────────────────────────────────────────
  //
  // Names are paired off shuffled pools rather than drawn independently, so
  // two people cannot collide on a name and therefore on a work email.
  const firstNames = random.shuffle([...FIRST_NAMES_F, ...FIRST_NAMES_M]);
  const lastNames = random.shuffle(LAST_NAMES);

  const plan: {
    departmentKey: keyof OrgFixtures['departments'];
    designation: string;
    structure: Structure;
    ctc: [number, number];
    manager: string | null;
    role?: RoleCode;
    count: number;
  }[] = [
    {
      departmentKey: 'sales',
      designation: 'Sales Manager',
      structure: 'LEAD',
      ctc: [130_000, 150_000],
      manager: 'admin@hrms.local',
      role: 'MANAGER',
      count: 1,
    },
    {
      departmentKey: 'platform',
      designation: 'Senior Software Engineer',
      structure: 'STD',
      ctc: [85_000, 110_000],
      manager: 'manager@hrms.local',
      count: 4,
    },
    {
      departmentKey: 'platform',
      designation: 'Software Engineer',
      structure: 'STD',
      ctc: [55_000, 75_000],
      manager: 'manager@hrms.local',
      count: 5,
    },
    {
      departmentKey: 'quality',
      designation: 'QA Engineer',
      structure: 'STD',
      ctc: [45_000, 62_000],
      manager: 'manager@hrms.local',
      count: 3,
    },
    {
      departmentKey: 'sales',
      designation: 'Sales Executive',
      structure: 'STD',
      ctc: [32_000, 48_000],
      manager: null,
      count: 4,
    },
    {
      departmentKey: 'peopleOps',
      designation: 'HR Executive',
      structure: 'STD',
      ctc: [38_000, 52_000],
      manager: 'hr@hrms.local',
      count: 2,
    },
    {
      departmentKey: 'finance',
      designation: 'Accounts Executive',
      structure: 'STD',
      ctc: [36_000, 50_000],
      manager: 'finance@hrms.local',
      count: 1,
    },
    {
      departmentKey: 'platform',
      designation: 'Intern',
      structure: 'CONTRACT',
      ctc: [15_000, 22_000],
      manager: 'manager@hrms.local',
      count: 1,
    },
  ];

  const locationNames = ['Ahmedabad', 'Pune', 'Bengaluru'];
  let index = 0;
  let salesManagerEmail: string | null = null;

  for (const group of plan) {
    for (let n = 0; n < group.count; n++) {
      const firstName = firstNames[index] as string;
      const lastName = lastNames[index % lastNames.length] as string;
      const email = `${firstName}.${lastName}`.toLowerCase().concat('@hrms.local');
      const gender = FIRST_NAMES_F.includes(firstName as (typeof FIRST_NAMES_F)[number])
        ? ('FEMALE' as const)
        : ('MALE' as const);

      const yearsHere = random.int(0, 5);
      const joinDate = `${year - yearsHere}-${String(random.int(1, 12)).padStart(2, '0')}-${String(random.int(1, 28)).padStart(2, '0')}`;

      specs.push({
        email,
        role: group.role ?? 'EMPLOYEE',
        firstName,
        lastName,
        gender,
        dob: `${random.int(1985, 2002)}-${String(random.int(1, 12)).padStart(2, '0')}-${String(random.int(1, 28)).padStart(2, '0')}`,
        joinDate: joinDate > todayKey ? `${year - 1}-06-01` : joinDate,
        status: 'ACTIVE',
        departmentKey: group.departmentKey,
        designation: group.designation,
        locationName: random.pick(locationNames),
        shift: random.chance(0.15) ? 'Late' : 'General',
        employmentType: group.designation === 'Intern' ? 'IN' : random.chance(0.12) ? 'PT' : 'FT',
        structure: group.structure,
        monthlyCtc: random.step(group.ctc[0], group.ctc[1], 1000),
        managerEmail: group.manager,
      });

      if (group.role === 'MANAGER') salesManagerEmail = email;
      index++;
    }
  }

  // The sales floor reports to the sales manager, who did not exist when their
  // rows were built.
  for (const spec of specs) {
    if (spec.designation === 'Sales Executive' && spec.managerEmail === null) {
      spec.managerEmail = salesManagerEmail;
    }
  }

  // ── Statuses worth filtering by ────────────────────────────────────────
  // Only the generated twenty-one are touched: the seven named logins have to
  // stay signed-in-able, and an exited admin is a workspace nobody can open.
  const pool = specs.slice(7);

  // Two hires who have not started: invited, filling in their details.
  for (const spec of pool.slice(0, 2)) {
    spec.status = 'ONBOARDING';
    spec.joinDate = dateKeyOf(toDate(addDays(todayKey, random.int(5, 20))));
  }
  // Three serving notice, leaving inside the next month.
  for (const [i, spec] of pool.slice(2, 5).entries()) {
    spec.status = 'ON_NOTICE';
    spec.exitDate = addDays(todayKey, 7 + i * 9);
  }
  // Three already gone, so attrition and the exited filter are not empty.
  for (const [i, spec] of pool.slice(5, 8).entries()) {
    spec.status = 'EXITED';
    spec.exitDate = addDays(todayKey, -20 - i * 25);
  }

  // Five on probation, two of them past their end date and nobody has noticed
  // — which is the actionable half of the dashboard tile.
  for (const [i, spec] of pool.slice(8, 13).entries()) {
    spec.probationEndDate = i < 2 ? addDays(todayKey, -12 - i * 9) : addDays(todayKey, 20 + i * 15);
  }
  // Everybody else long since confirmed.
  for (const spec of specs) {
    if (!spec.probationEndDate && spec.status === 'ACTIVE') {
      spec.confirmedOn = addDays(spec.joinDate, 180);
    }
  }
  // One long notice period, so the per-employee override is visible somewhere.
  if (pool[13]) pool[13].noticePeriodDays = 90;

  // ── Celebrations inside the window ─────────────────────────────────────
  //
  // Computed from today rather than written down. Fixed dates were why the
  // panel read "nothing coming up" on most days of the year.
  const birthdayFolk = pool.filter((s) => s.status === 'ACTIVE').slice(0, 3);
  for (const [i, spec] of birthdayFolk.entries()) {
    spec.dob = `${spec.dob.slice(0, 4)}-${safeMonthDay(addDays(todayKey, 2 + i * 7))}`;
  }
  const anniversaryFolk = pool.filter((s) => s.status === 'ACTIVE').slice(3, 6);
  for (const [i, spec] of anniversaryFolk.entries()) {
    spec.joinDate = `${year - (2 + i)}-${safeMonthDay(addDays(todayKey, 4 + i * 8))}`;
    spec.confirmedOn = addDays(spec.joinDate, 180);
  }

  // ── Write ──────────────────────────────────────────────────────────────
  const all: SeededPerson[] = [];

  for (const [i, spec] of specs.entries()) {
    const bank = random.pick(BANKS);
    const user = await prisma.user.create({
      data: {
        organizationId: orgId,
        email: spec.email,
        passwordHash,
        status:
          spec.status === 'ONBOARDING'
            ? 'INVITED'
            : spec.status === 'EXITED'
              ? 'SUSPENDED'
              : 'ACTIVE',
        roleId: roles[spec.role] as string,
        lastLoginAt:
          spec.status === 'ONBOARDING' ? null : toDate(addDays(todayKey, -random.int(0, 5))),
      },
    });

    const employee = await prisma.employee.create({
      data: {
        organizationId: orgId,
        userId: user.id,
        employeeCode: `EMP-${String(i + 1).padStart(4, '0')}`,
        firstName: spec.firstName,
        lastName: spec.lastName,
        workEmail: spec.email,
        personalEmail: `${spec.firstName}.${spec.lastName}`.toLowerCase().concat('@example.com'),
        phone: `+91 9${random.int(10_000_000, 99_999_999)}${random.int(0, 9)}`,
        dateOfBirth: toDate(spec.dob),
        gender: spec.gender,
        addressLine: `${random.int(1, 99)} ${random.pick(STREETS)}`,
        city: spec.locationName,
        country: 'India',
        departmentId: d[spec.departmentKey].id,
        designationId: org.designationId(spec.designation),
        locationId: org.location(spec.locationName).id,
        shiftId: org.shiftId(spec.shift),
        employmentTypeId: org.employmentTypeId(spec.employmentType),
        status: spec.status,
        joinDate: toDate(spec.joinDate),
        exitDate: spec.exitDate ? toDate(spec.exitDate) : null,
        probationEndDate: spec.probationEndDate ? toDate(spec.probationEndDate) : null,
        confirmedOn: spec.confirmedOn ? toDate(spec.confirmedOn) : null,
        remoteDaysPerWeek: spec.remoteDaysPerWeek ?? null,
        noticePeriodDays: spec.noticePeriodDays ?? null,
        bankDetail: {
          create: {
            accountHolderName: `${spec.firstName} ${spec.lastName}`,
            bankName: bank.bankName,
            ifscCode: bank.ifscCode,
            accountNumber: String(random.int(10_000_000, 99_999_999)).concat(
              String(random.int(1000, 9999)),
            ),
            branch: spec.locationName,
          },
        },
        emergencyContacts: {
          create: {
            name: `${random.pick(FIRST_NAMES_M)} ${spec.lastName}`,
            relation: random.pick(RELATIONS),
            phone: `+91 9${random.int(10_000_000, 99_999_999)}${random.int(0, 9)}`,
          },
        },
      },
    });

    all.push({
      employeeId: employee.id,
      userId: user.id,
      email: spec.email,
      code: employee.employeeCode,
      firstName: spec.firstName,
      lastName: spec.lastName,
      status: spec.status,
      role: spec.role,
      joinDate: spec.joinDate,
      exitDate: spec.exitDate ?? null,
      departmentId: d[spec.departmentKey].id,
      departmentName: d[spec.departmentKey].name,
      locationId: org.location(spec.locationName).id,
      designation: spec.designation,
      structure: spec.structure,
      monthlyCtc: spec.monthlyCtc,
      monthlyTds: Math.round((spec.monthlyCtc * 0.09) / 100) * 100,
      managerEmail: spec.managerEmail,
    });
  }

  const byEmail = (email: string) => all.find((p) => p.email === email) as SeededPerson;

  for (const person of all) {
    if (!person.managerEmail) continue;
    await prisma.employee.update({
      where: { id: person.employeeId },
      data: { managerId: byEmail(person.managerEmail).employeeId },
    });
  }

  for (const [key, email] of [
    ['engineering', 'manager@hrms.local'],
    ['peopleOps', 'hr@hrms.local'],
    ['finance', 'finance@hrms.local'],
  ] as const) {
    await prisma.department.update({
      where: { id: d[key].id },
      data: { headId: byEmail(email).employeeId },
    });
  }

  return {
    all,
    staff: all.filter((p) => p.status === 'ACTIVE' || p.status === 'ON_NOTICE'),
    byEmail,
    emp: (email: string) => byEmail(email).employeeId,
    usr: (email: string) => byEmail(email).userId,
  };
}

/**
 * One completed bulk import, so the history screen has something to show.
 *
 * `rows` holds the **outcome per row and nothing else**. The column carries
 * names, emails and dates of birth while a preview is open and is pruned at
 * commit, because keeping it would be a second copy of everybody's personal
 * data with no retention story of its own (schema.prisma, EmployeeImport.rows).
 * A seeded import that skipped the pruning would model the exact thing the
 * pruning exists to prevent, so this row is stored in its committed shape.
 *
 * One row rather than several: the screen is a history, and a history with one
 * entry reads correctly. Seeding a FAILED one too would be inventing a failure
 * nobody had.
 */
export async function seedImportHistory(prisma: PrismaClient, orgId: string, people: People) {
  const uploader = people.byEmail('hr@hrms.local');

  await prisma.employeeImport.create({
    data: {
      organizationId: orgId,
      uploadedById: uploader?.userId ?? null,
      fileName: 'new-joiners-april.csv',
      rowCount: 6,
      mode: 'RECORDS',
      status: 'PARTIAL',
      // PARTIAL rather than COMMITTED, because that is the state worth being
      // able to look at: a clean import tells you nothing the count does not.
      rows: [
        { row: 2, outcome: 'created', employeeCode: 'EMP-0029' },
        { row: 3, outcome: 'created', employeeCode: 'EMP-0030' },
        { row: 4, outcome: 'created', employeeCode: 'EMP-0031' },
        { row: 5, outcome: 'created', employeeCode: 'EMP-0032' },
        { row: 6, outcome: 'failed', error: 'A person with that work email already exists' },
        { row: 7, outcome: 'failed', error: 'Joining date is not a date' },
      ],
      createdCount: 4,
      failedCount: 2,
      invitedCount: 0,
      committedAt: new Date('2026-04-08T06:30:00Z'),
    },
  });
}
