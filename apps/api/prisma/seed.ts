import 'dotenv/config';
import {
  DEFAULT_DOCUMENT_CATEGORIES,
  DEFAULT_PAY_COMPONENTS,
  defaultSettings,
  ROLE_PERMISSIONS,
  SYSTEM_ROLES,
} from '@hrms/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import { calculatePayslip } from '../src/modules/payroll/payroll.calc';

/**
 * Demo seed — a workspace you can sign into and actually exercise.
 *
 * Every module gets enough data to verify it end to end: an org chart with
 * real reporting lines, four weeks of attendance including late marks, half
 * days and absences, leave balances with approved/pending/rejected requests,
 * announcements across every category, documents and an audit trail.
 *
 * It is destructive by design — it wipes the seeded organization first, so
 * repeated runs produce an identical workspace instead of accumulating
 * duplicates. Refuses to run against NODE_ENV=production without an override.
 */

const ORG_SLUG = 'default';
const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!2026';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set`);
  return value;
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: requireEnv('DATABASE_URL') }),
});

// ── date helpers (@db.Date columns are UTC midnight) ─────────────────────
const DAY = 86_400_000;
const dateKey = (d: Date) => d.toISOString().slice(0, 10);
const toDate = (key: string) => new Date(`${key}T00:00:00.000Z`);
const at = (key: string, hhmm: string) => new Date(`${key}T${hhmm}:00.000Z`);
const shift = (days: number) => new Date(Date.now() + days * DAY);
const isWeekend = (key: string) => [0, 6].includes(new Date(`${key}T00:00:00Z`).getUTCDay());

/** Working-day keys between two offsets from today, oldest first. */
function workingDays(fromOffset: number, toOffset: number): string[] {
  const days: string[] = [];
  for (let i = fromOffset; i <= toOffset; i++) {
    const key = dateKey(shift(i));
    if (!isWeekend(key)) days.push(key);
  }
  return days;
}

/** Child rows first so foreign keys never block the delete. */
async function wipe(orgId: string) {
  // Notification has no relation to User — only a bare userId — so its rows
  // have to be found by id before the users disappear.
  const userIds = (
    await prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true } })
  ).map((u) => u.id);

  await prisma.$transaction([
    // Payroll first: payslip lines hang off payslips, payslips off runs, and
    // salary assignments off both employees and structures.
    prisma.payslipLine.deleteMany({ where: { payslip: { organizationId: orgId } } }),
    prisma.payslip.deleteMany({ where: { organizationId: orgId } }),
    prisma.payrollRun.deleteMany({ where: { organizationId: orgId } }),
    prisma.employeeSalary.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.structureLine.deleteMany({ where: { structure: { organizationId: orgId } } }),
    prisma.salaryStructure.deleteMany({ where: { organizationId: orgId } }),
    prisma.payComponent.deleteMany({ where: { organizationId: orgId } }),
    prisma.announcementRead.deleteMany({ where: { announcement: { organizationId: orgId } } }),
    prisma.announcementAttachment.deleteMany({
      where: { announcement: { organizationId: orgId } },
    }),
    prisma.announcement.deleteMany({ where: { organizationId: orgId } }),
    prisma.document.deleteMany({ where: { organizationId: orgId } }),
    prisma.documentCategory.deleteMany({ where: { organizationId: orgId } }),
    prisma.attendanceRequest.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.attendanceRecord.deleteMany({ where: { organizationId: orgId } }),
    prisma.leaveRequest.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.leaveBalance.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.leaveType.deleteMany({ where: { organizationId: orgId } }),
    prisma.bankDetail.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.emergencyContact.deleteMany({ where: { employee: { organizationId: orgId } } }),
    prisma.notification.deleteMany({ where: { userId: { in: userIds } } }),
    prisma.auditLog.deleteMany({ where: { organizationId: orgId } }),
    prisma.setting.deleteMany({ where: { organizationId: orgId } }),
    prisma.emailTemplate.deleteMany({ where: { organizationId: orgId } }),
  ]);
  // Two self-referencing cycles to break: a department points at its head, an
  // employee points at their manager.
  await prisma.department.updateMany({ where: { organizationId: orgId }, data: { headId: null } });
  await prisma.employee.updateMany({ where: { organizationId: orgId }, data: { managerId: null } });
  await prisma.$transaction([
    prisma.employee.deleteMany({ where: { organizationId: orgId } }),
    prisma.refreshSession.deleteMany({ where: { user: { organizationId: orgId } } }),
    prisma.passwordResetToken.deleteMany({ where: { user: { organizationId: orgId } } }),
    prisma.user.deleteMany({ where: { organizationId: orgId } }),
    prisma.holiday.deleteMany({ where: { organizationId: orgId } }),
    prisma.shift.deleteMany({ where: { organizationId: orgId } }),
    prisma.employmentType.deleteMany({ where: { organizationId: orgId } }),
    prisma.designation.deleteMany({ where: { organizationId: orgId } }),
    prisma.department.deleteMany({ where: { organizationId: orgId } }),
    prisma.location.deleteMany({ where: { organizationId: orgId } }),
  ]);
}

interface PersonSpec {
  email: string;
  role: 'ADMIN' | 'HR' | 'FINANCE' | 'MANAGER' | 'EMPLOYEE';
  code: string;
  firstName: string;
  lastName: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  dob: string;
  phone: string;
  personalEmail: string;
  address: string;
  city: string;
  joinDate: string;
  bank: { bankName: string; accountNumber: string; ifscCode: string; branch: string };
  kin: { name: string; relation: string; phone: string };
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOW_RESET !== 'true') {
    throw new Error('Refusing to reset a production database. Set SEED_ALLOW_RESET=true to force.');
  }

  const org = await prisma.organization.upsert({
    where: { slug: ORG_SLUG },
    update: { name: 'Acme Industries', timezone: 'Asia/Kolkata' },
    create: { name: 'Acme Industries', slug: ORG_SLUG, timezone: 'Asia/Kolkata' },
  });

  console.log('Resetting the demo workspace…');
  await wipe(org.id);

  // ── RBAC ───────────────────────────────────────────────────────────────
  const roles: Record<string, string> = {};
  for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const meta = SYSTEM_ROLES.find((r) => r.code === roleCode);
    if (!meta) continue;
    const role = await prisma.role.upsert({
      where: { organizationId_code: { organizationId: org.id, code: roleCode } },
      update: { name: meta.name, description: meta.description },
      create: {
        organizationId: org.id,
        code: roleCode,
        name: meta.name,
        description: meta.description,
        isSystem: true,
      },
    });
    roles[roleCode] = role.id;
    // Additive: a grant revoked from Settings must not reappear on re-seed.
    for (const code of perms) {
      const [resource = code, ...rest] = code.split('.');
      const permission = await prisma.permission.upsert({
        where: { code },
        update: {},
        create: { code, resource, action: rest.join('.') },
      });
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
    }
  }

  // ── Organization structure ─────────────────────────────────────────────
  const hq = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: 'Ahmedabad HQ',
      type: 'HEAD_OFFICE',
      address: '4th Floor, Titanium One, Prahladnagar',
      city: 'Ahmedabad',
      country: 'India',
      timezone: 'Asia/Kolkata',
    },
  });
  const pune = await prisma.location.create({
    data: {
      organizationId: org.id,
      name: 'Pune Branch',
      type: 'BRANCH',
      address: 'Level 3, Amar Tech Park, Balewadi',
      city: 'Pune',
      country: 'India',
      timezone: 'Asia/Kolkata',
    },
  });

  const engineering = await prisma.department.create({
    data: { organizationId: org.id, name: 'Engineering', code: 'ENG' },
  });
  const peopleOps = await prisma.department.create({
    data: { organizationId: org.id, name: 'People Operations', code: 'HR' },
  });
  const salesDept = await prisma.department.create({
    data: { organizationId: org.id, name: 'Sales', code: 'SLS' },
  });
  const platform = await prisma.department.create({
    data: { organizationId: org.id, name: 'Platform', code: 'PLT', parentId: engineering.id },
  });

  const designations = await Promise.all(
    [
      { title: 'Chief Executive Officer', level: 10 },
      { title: 'Engineering Manager', level: 7 },
      { title: 'HR Manager', level: 6 },
      { title: 'Senior Software Engineer', level: 5 },
      { title: 'Software Engineer', level: 4 },
      { title: 'Sales Executive', level: 4 },
      { title: 'Finance Manager', level: 6 },
    ].map((d) => prisma.designation.create({ data: { organizationId: org.id, ...d } })),
  );
  const designationId = (title: string) => designations.find((d) => d.title === title)?.id;

  const employmentTypes = await Promise.all(
    [
      { name: 'Full-time', code: 'FT' },
      { name: 'Part-time', code: 'PT' },
      { name: 'Contract', code: 'CT' },
      { name: 'Intern', code: 'IN' },
    ].map((et) => prisma.employmentType.create({ data: { organizationId: org.id, ...et } })),
  );
  const fullTime = employmentTypes[0]?.id;
  const contract = employmentTypes[2]?.id;

  const general = await prisma.shift.create({
    data: {
      organizationId: org.id,
      name: 'General',
      startTime: '09:30',
      endTime: '18:30',
      graceMinutes: 15,
    },
  });
  const early = await prisma.shift.create({
    data: {
      organizationId: org.id,
      name: 'Early',
      startTime: '07:00',
      endTime: '16:00',
      graceMinutes: 10,
    },
  });

  const year = new Date().getUTCFullYear();
  await prisma.holiday.createMany({
    data: [
      { name: 'Republic Day', date: toDate(`${year}-01-26`) },
      { name: 'Holi', date: toDate(`${year}-03-14`) },
      { name: 'Independence Day', date: toDate(`${year}-08-15`) },
      { name: 'Gandhi Jayanti', date: toDate(`${year}-10-02`) },
      { name: 'Diwali', date: toDate(`${year}-11-08`) },
      { name: 'Christmas Day', date: toDate(`${year}-12-25`) },
      { name: 'Founders Day', date: toDate(`${year}-09-12`), isOptional: true },
      { name: 'Maharashtra Day', date: toDate(`${year}-05-01`), locationId: pune.id },
    ].map((h) => ({ organizationId: org.id, ...h })),
  });

  const leaveTypes = await Promise.all(
    [
      { name: 'Casual Leave', code: 'CL', daysPerYear: 12 },
      { name: 'Sick Leave', code: 'SL', daysPerYear: 8 },
      {
        name: 'Earned Leave',
        code: 'EL',
        daysPerYear: 15,
        carryForward: true,
        maxCarryForward: 30,
      },
      { name: 'Unpaid Leave', code: 'LWP', daysPerYear: 0, isPaid: false },
    ].map((lt) => prisma.leaveType.create({ data: { organizationId: org.id, ...lt } })),
  );
  const leaveTypeId = (code: string) => leaveTypes.find((l) => l.code === code)?.id as string;

  const categories = await Promise.all(
    DEFAULT_DOCUMENT_CATEGORIES.map((name) =>
      prisma.documentCategory.create({ data: { organizationId: org.id, name } }),
    ),
  );

  // ── Payroll catalogue ──────────────────────────────────────────────────
  // Seeded as isSystem: the calculation engine looks these codes up by name,
  // so they must exist and must not be deletable.
  const payComponents = await Promise.all(
    DEFAULT_PAY_COMPONENTS.map((c, index) =>
      prisma.payComponent.create({
        data: { organizationId: org.id, ...c, isSystem: true, order: index },
      }),
    ),
  );
  const componentId = (code: string) => payComponents.find((c) => c.code === code)?.id as string;

  // ── People ─────────────────────────────────────────────────────────────
  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  const people: (PersonSpec & {
    departmentId: string;
    designation: string;
    locationId: string;
    shiftId: string;
    employmentTypeId?: string;
  })[] = [
    {
      email: 'admin@hrms.local',
      role: 'ADMIN',
      code: 'EMP-0001',
      firstName: 'Aarav',
      lastName: 'Shah',
      gender: 'MALE',
      dob: '1984-04-12',
      phone: '+91 98250 11001',
      personalEmail: 'aarav.shah@example.com',
      address: '12 Satellite Road, Vastrapur',
      city: 'Ahmedabad',
      joinDate: `${year - 6}-01-15`,
      departmentId: peopleOps.id,
      designation: 'Chief Executive Officer',
      locationId: hq.id,
      shiftId: general.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'HDFC Bank',
        accountNumber: '50100234567801',
        ifscCode: 'HDFC0001234',
        branch: 'Vastrapur',
      },
      kin: { name: 'Nisha Shah', relation: 'Spouse', phone: '+91 98250 11002' },
    },
    {
      email: 'hr@hrms.local',
      role: 'HR',
      code: 'EMP-0002',
      firstName: 'Priya',
      lastName: 'Nair',
      gender: 'FEMALE',
      dob: '1990-09-03',
      phone: '+91 98250 22001',
      personalEmail: 'priya.nair@example.com',
      address: '7 Bodakdev Lane',
      city: 'Ahmedabad',
      joinDate: `${year - 4}-06-01`,
      departmentId: peopleOps.id,
      designation: 'HR Manager',
      locationId: hq.id,
      shiftId: general.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'ICICI Bank',
        accountNumber: '002401567890',
        ifscCode: 'ICIC0000024',
        branch: 'Bodakdev',
      },
      kin: { name: 'Rajesh Nair', relation: 'Father', phone: '+91 98250 22002' },
    },
    {
      email: 'manager@hrms.local',
      role: 'MANAGER',
      code: 'EMP-0003',
      firstName: 'Meera',
      lastName: 'Iyer',
      gender: 'FEMALE',
      dob: '1988-12-21',
      phone: '+91 98250 33001',
      personalEmail: 'meera.iyer@example.com',
      address: '21 Prahladnagar Garden',
      city: 'Ahmedabad',
      joinDate: `${year - 5}-03-10`,
      departmentId: engineering.id,
      designation: 'Engineering Manager',
      locationId: hq.id,
      shiftId: general.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'Axis Bank',
        accountNumber: '918010045612378',
        ifscCode: 'UTIB0000123',
        branch: 'Prahladnagar',
      },
      kin: { name: 'Suresh Iyer', relation: 'Spouse', phone: '+91 98250 33002' },
    },
    {
      email: 'asha@hrms.local',
      role: 'EMPLOYEE',
      code: 'EMP-0004',
      firstName: 'Asha',
      lastName: 'Verma',
      gender: 'FEMALE',
      dob: '1996-02-17',
      phone: '+91 98250 44001',
      personalEmail: 'asha.verma@example.com',
      address: '9 Navrangpura Cross Road',
      city: 'Ahmedabad',
      joinDate: `${year - 2}-07-05`,
      departmentId: platform.id,
      designation: 'Senior Software Engineer',
      locationId: hq.id,
      shiftId: general.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'State Bank of India',
        accountNumber: '30124567890',
        ifscCode: 'SBIN0001122',
        branch: 'Navrangpura',
      },
      kin: { name: 'Kavita Verma', relation: 'Mother', phone: '+91 98250 44002' },
    },
    {
      email: 'rohan@hrms.local',
      role: 'EMPLOYEE',
      code: 'EMP-0005',
      firstName: 'Rohan',
      lastName: 'Desai',
      gender: 'MALE',
      dob: '1998-06-30',
      phone: '+91 98250 55001',
      personalEmail: 'rohan.desai@example.com',
      address: '18 Baner Road',
      city: 'Pune',
      joinDate: `${year - 1}-02-20`,
      departmentId: platform.id,
      designation: 'Software Engineer',
      locationId: pune.id,
      shiftId: early.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'Kotak Mahindra Bank',
        accountNumber: '7411220033',
        ifscCode: 'KKBK0000456',
        branch: 'Baner',
      },
      kin: { name: 'Anil Desai', relation: 'Father', phone: '+91 98250 55002' },
    },
    {
      email: 'zara@hrms.local',
      role: 'EMPLOYEE',
      code: 'EMP-0006',
      firstName: 'Zara',
      lastName: 'Khan',
      gender: 'FEMALE',
      dob: '2000-11-08',
      phone: '+91 98250 66001',
      personalEmail: 'zara.khan@example.com',
      address: '3 Kalyani Nagar',
      city: 'Pune',
      joinDate: `${year}-01-08`,
      departmentId: salesDept.id,
      designation: 'Sales Executive',
      locationId: pune.id,
      shiftId: general.id,
      employmentTypeId: contract,
      bank: {
        bankName: 'Yes Bank',
        accountNumber: '000112233445',
        ifscCode: 'YESB0000011',
        branch: 'Kalyani Nagar',
      },
      kin: { name: 'Imran Khan', relation: 'Brother', phone: '+91 98250 66002' },
    },
    {
      email: 'finance@hrms.local',
      role: 'FINANCE',
      code: 'EMP-0007',
      firstName: 'Vikram',
      lastName: 'Rao',
      gender: 'MALE',
      dob: '1986-02-19',
      phone: '+91 98250 77001',
      personalEmail: 'vikram.rao@example.com',
      address: '9 Prahlad Nagar',
      city: 'Ahmedabad',
      joinDate: `${year - 3}-07-01`,
      departmentId: peopleOps.id,
      designation: 'Finance Manager',
      locationId: hq.id,
      shiftId: general.id,
      employmentTypeId: fullTime,
      bank: {
        bankName: 'Axis Bank',
        accountNumber: '918020045566778',
        ifscCode: 'UTIB0000123',
        branch: 'Prahlad Nagar',
      },
      kin: { name: 'Anita Rao', relation: 'Spouse', phone: '+91 98250 77002' },
    },
  ];

  const created: Record<string, { employeeId: string; userId: string }> = {};
  for (const p of people) {
    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        email: p.email,
        passwordHash,
        status: 'ACTIVE',
        roleId: roles[p.role] as string,
        lastLoginAt: shift(-1),
      },
    });
    const employee = await prisma.employee.create({
      data: {
        organizationId: org.id,
        userId: user.id,
        employeeCode: p.code,
        firstName: p.firstName,
        lastName: p.lastName,
        workEmail: p.email,
        personalEmail: p.personalEmail,
        phone: p.phone,
        dateOfBirth: toDate(p.dob),
        gender: p.gender,
        addressLine: p.address,
        city: p.city,
        country: 'India',
        departmentId: p.departmentId,
        designationId: designationId(p.designation),
        locationId: p.locationId,
        shiftId: p.shiftId,
        employmentTypeId: p.employmentTypeId,
        status: 'ACTIVE',
        joinDate: toDate(p.joinDate),
        bankDetail: {
          create: { accountHolderName: `${p.firstName} ${p.lastName}`, ...p.bank },
        },
        emergencyContacts: { create: p.kin },
      },
    });
    created[p.email] = { employeeId: employee.id, userId: user.id };
  }

  const emp = (email: string) => created[email]?.employeeId as string;
  const usr = (email: string) => created[email]?.userId as string;

  // Reporting lines: engineers report to Meera; Meera and Priya to Aarav.
  for (const [child, parent] of [
    ['asha@hrms.local', 'manager@hrms.local'],
    ['rohan@hrms.local', 'manager@hrms.local'],
    ['zara@hrms.local', 'hr@hrms.local'],
    ['manager@hrms.local', 'admin@hrms.local'],
    ['hr@hrms.local', 'admin@hrms.local'],
  ] as const) {
    await prisma.employee.update({
      where: { id: emp(child) },
      data: { managerId: emp(parent) },
    });
  }
  await prisma.department.update({
    where: { id: engineering.id },
    data: { headId: emp('manager@hrms.local') },
  });
  await prisma.department.update({
    where: { id: peopleOps.id },
    data: { headId: emp('hr@hrms.local') },
  });

  // ── Attendance: four weeks, so calendars and report rates have shape ────
  const days = workingDays(-41, 0);
  const staff = [
    'manager@hrms.local',
    'hr@hrms.local',
    'asha@hrms.local',
    'rohan@hrms.local',
    'zara@hrms.local',
  ];
  const today = dateKey(new Date());
  const seedDays = days.flatMap((key, dayIndex) =>
    staff.flatMap((email, person) => {
      // Asha is left unmarked today so you can exercise clock-in yourself;
      // everyone else is already in, so "Present today" is a real number.
      if (key === today && email === 'asha@hrms.local') return [];
      // A deterministic sprinkle, so every derived status shows up somewhere
      // without the seed being random run to run.
      const slot = (dayIndex * 7 + person * 3) % 17;
      if (slot === 4) return []; // absent — no row; ABSENT is derived on read
      const late = slot === 1 || slot === 9;
      const half = slot === 12;
      const wfh = slot === 6;
      const isEarlyShift = email === 'rohan@hrms.local';
      // Two sittings around lunch, and the odd day someone forgets to clock
      // out — both are ordinary, and both need real rows to render against.
      const split = slot === 3 && !isEarlyShift;
      const forgotOut = slot === 8;
      // WFH is earned from the sittings now, so a work-from-home day has to be
      // made of remote ones rather than asserted on the record.
      const workMode = wfh
        ? ('REMOTE' as const)
        : slot === 15
          ? ('CLIENT_SITE' as const)
          : ('OFFICE' as const);
      const checkIn = at(key, late ? '10:05' : isEarlyShift ? '07:02' : '09:24');
      const checkOut = at(key, half ? '13:30' : isEarlyShift ? '16:10' : '18:36');
      const sessions: { checkIn: Date; checkOut: Date | null }[] = split
        ? [
            { checkIn, checkOut: at(key, '13:12') },
            { checkIn: at(key, '14:06'), checkOut },
          ]
        : [{ checkIn, checkOut: forgotOut ? null : checkOut }];
      return [
        {
          key,
          employeeId: emp(email),
          sessions,
          workMode,
          isLate: late,
          status: half ? ('HALF_DAY' as const) : wfh ? ('WFH' as const) : ('PRESENT' as const),
          note: half ? 'Left early — personal appointment' : null,
        },
      ];
    }),
  );

  const minutesOf = (s: { checkIn: Date; checkOut: Date | null }) =>
    s.checkOut ? Math.round((s.checkOut.getTime() - s.checkIn.getTime()) / 60_000) : 0;

  await prisma.attendanceRecord.createMany({
    // The record's times are a rollup of its sessions, so build them that way
    // here too rather than letting the seed invent a shape the API never makes.
    data: seedDays.map((day) => {
      const last = day.sessions[day.sessions.length - 1] as (typeof day.sessions)[number];
      return {
        organizationId: org.id,
        employeeId: day.employeeId,
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

  // createMany cannot nest children and returns no ids, so the sessions are
  // matched back onto their records by the pair that makes a day unique.
  const attendanceRows = await prisma.attendanceRecord.findMany({
    where: { organizationId: org.id },
    select: { id: true, employeeId: true, date: true },
  });
  const recordIds = new Map(
    attendanceRows.map((r) => [`${r.employeeId}|${dateKey(r.date)}`, r.id]),
  );
  await prisma.attendanceSession.createMany({
    data: seedDays.flatMap((day) => {
      const recordId = recordIds.get(`${day.employeeId}|${day.key}`);
      return recordId
        ? day.sessions.map((s) => ({
            recordId,
            checkIn: s.checkIn,
            checkOut: s.checkOut,
            workMode: day.workMode,
            source: 'WEB' as const,
          }))
        : [];
    }),
  });

  // One pending correction for the manager's inbox, one already decided.
  const pendingDay = days.at(-4) as string;
  const decidedDay = days.at(-9) as string;
  await prisma.attendanceRequest.create({
    data: {
      employeeId: emp('asha@hrms.local'),
      date: toDate(pendingDay),
      requestedIn: at(pendingDay, '09:15'),
      requestedOut: at(pendingDay, '18:40'),
      reason: 'Client visit in the morning — could not clock in from the office',
      status: 'PENDING',
    },
  });
  await prisma.attendanceRequest.create({
    data: {
      employeeId: emp('rohan@hrms.local'),
      date: toDate(decidedDay),
      requestedIn: at(decidedDay, '07:00'),
      requestedOut: at(decidedDay, '16:05'),
      reason: 'Badge reader was down at the Pune office',
      status: 'APPROVED',
      approverId: emp('manager@hrms.local'),
      actedAt: shift(-8),
      approverNote: 'Confirmed with facilities.',
    },
  });

  // ── Leave: balances for everyone, then a spread of request states ───────
  await prisma.leaveBalance.createMany({
    data: people.flatMap((p) =>
      leaveTypes.map((lt) => ({
        employeeId: emp(p.email),
        leaveTypeId: lt.id,
        year,
        allocated: lt.daysPerYear,
        used: 0,
        carriedOver: lt.code === 'EL' ? 4 : 0,
      })),
    ),
    skipDuplicates: true,
  });

  const bookLeave = async (input: {
    email: string;
    code: string;
    start: string;
    end: string;
    days: number;
    reason: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    approver?: string;
    note?: string;
  }) => {
    await prisma.leaveRequest.create({
      data: {
        employeeId: emp(input.email),
        leaveTypeId: leaveTypeId(input.code),
        startDate: toDate(input.start),
        endDate: toDate(input.end),
        leaveYear: year,
        days: input.days,
        reason: input.reason,
        status: input.status,
        ...(input.approver
          ? { approverId: emp(input.approver), actedAt: shift(-3), approverNote: input.note }
          : {}),
      },
    });
    // Only approved leave consumes balance — mirrors the booking transaction.
    if (input.status === 'APPROVED') {
      await prisma.leaveBalance.update({
        where: {
          employeeId_leaveTypeId_year: {
            employeeId: emp(input.email),
            leaveTypeId: leaveTypeId(input.code),
            year,
          },
        },
        data: { used: { increment: input.days } },
      });
    }
  };

  await bookLeave({
    email: 'asha@hrms.local',
    code: 'CL',
    start: dateKey(shift(6)),
    end: dateKey(shift(8)),
    days: 3,
    reason: 'Family function out of town',
    status: 'PENDING',
  });
  await bookLeave({
    email: 'manager@hrms.local',
    code: 'CL',
    start: dateKey(shift(14)),
    end: dateKey(shift(15)),
    days: 2,
    reason: "Daughter's school event",
    status: 'PENDING',
  });
  await bookLeave({
    email: 'rohan@hrms.local',
    code: 'SL',
    start: dateKey(shift(-12)),
    end: dateKey(shift(-11)),
    days: 2,
    reason: 'Viral fever — doctor advised rest',
    status: 'APPROVED',
    approver: 'manager@hrms.local',
    note: 'Get well soon.',
  });
  await bookLeave({
    email: 'asha@hrms.local',
    code: 'EL',
    start: dateKey(shift(-30)),
    end: dateKey(shift(-26)),
    days: 5,
    reason: 'Annual holiday',
    status: 'APPROVED',
    approver: 'manager@hrms.local',
  });
  await bookLeave({
    email: 'zara@hrms.local',
    code: 'CL',
    start: dateKey(shift(-5)),
    end: dateKey(shift(-5)),
    days: 1,
    reason: 'Personal errand',
    status: 'REJECTED',
    approver: 'hr@hrms.local',
    note: 'Quarter close — please pick another day.',
  });

  // ── Announcements: every category, including a pinned urgent notice ─────
  const announcements = [
    {
      title: 'Payroll cut-off moves to the 22nd',
      body: 'Timesheets and expense claims must be submitted by the **22nd** this month.\n\nAnything later moves to the following cycle.',
      category: 'GENERAL' as const,
      priority: 'URGENT' as const,
      isPinned: true,
      author: 'admin@hrms.local',
    },
    {
      title: 'Diwali holiday schedule',
      body: 'The office is **closed 8–10 November**. No attendance is required and no leave is deducted.\n\nOn-call rotas are unchanged — please check the roster.',
      category: 'HOLIDAY' as const,
      priority: 'NORMAL' as const,
      isPinned: true,
      author: 'hr@hrms.local',
    },
    {
      title: 'Updated leave policy — earned leave carry-forward',
      body: 'From this leave year, up to **30 days** of Earned Leave may be carried forward.\n\nAnything above the cap lapses at year end, so please plan with your manager.',
      category: 'POLICY' as const,
      priority: 'HIGH' as const,
      isPinned: false,
      author: 'hr@hrms.local',
    },
    {
      title: 'Please welcome Zara Khan to Sales',
      body: 'Zara joins us in the Pune office as a Sales Executive. Say hello when you get a chance.',
      category: 'GENERAL' as const,
      priority: 'NORMAL' as const,
      isPinned: false,
      author: 'hr@hrms.local',
    },
    {
      title: 'Birthdays this month',
      body: '- Asha Verma — 17th\n- Rohan Desai — 30th\n\nCake in the Ahmedabad pantry at 4pm on both days.',
      category: 'BIRTHDAY' as const,
      priority: 'NORMAL' as const,
      isPinned: false,
      author: 'admin@hrms.local',
    },
  ];

  for (const [index, a] of announcements.entries()) {
    const row = await prisma.announcement.create({
      data: {
        organizationId: org.id,
        title: a.title,
        body: a.body,
        category: a.category,
        priority: a.priority,
        audience: 'ALL',
        isPinned: a.isPinned,
        publishAt: shift(-index * 2 - 1),
        authorId: usr(a.author),
      },
    });
    // A few reads so the receipts view has something to show.
    if (index < 2) {
      await prisma.announcementRead.createMany({
        data: [usr('asha@hrms.local'), usr('rohan@hrms.local')].map((userId) => ({
          announcementId: row.id,
          userId,
        })),
        skipDuplicates: true,
      });
    }
  }

  // ── Documents: metadata only — a seed has no object storage behind it ───
  const categoryId = (needle: string) =>
    categories.find((c) => c.name.toLowerCase().includes(needle))?.id ?? null;
  const docs = [
    { email: 'asha@hrms.local', name: 'Asha Verma — Resume.pdf', cat: 'resume', size: 184_320 },
    { email: 'asha@hrms.local', name: 'Offer Letter.pdf', cat: 'offer', size: 96_150 },
    { email: 'rohan@hrms.local', name: 'Rohan Desai — Resume.pdf', cat: 'resume', size: 172_800 },
    { email: 'zara@hrms.local', name: 'Offer Letter.pdf', cat: 'offer', size: 91_400 },
  ];
  await prisma.document.createMany({
    data: docs.map((d, i) => ({
      organizationId: org.id,
      employeeId: emp(d.email),
      categoryId: categoryId(d.cat),
      name: d.name,
      fileKey: `seed/${org.id}/${i + 1}-${d.name.replace(/\s+/g, '-').toLowerCase()}`,
      mimeType: 'application/pdf',
      sizeBytes: d.size,
      visibility: 'PRIVATE' as const,
      uploadedById: usr('hr@hrms.local'),
    })),
  });

  // ── Payroll: structures, salaries, and a settled month ─────────────────
  //
  // The published run is calculated with the real engine rather than
  // hand-written figures, so the seed cannot drift away from the code and a
  // demo payslip always adds up.

  const standard = await prisma.salaryStructure.create({
    data: {
      organizationId: org.id,
      name: 'Standard Staff',
      code: 'STD',
      description: '40% basic, HRA at half of basic, the rest as special allowance',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 40, order: 1 },
          { componentId: componentId('HRA'), calcType: 'PERCENT_OF_BASIC', value: 50, order: 2 },
          { componentId: componentId('CONVEYANCE'), calcType: 'FLAT', value: 1600, order: 3 },
          { componentId: componentId('MEDICAL'), calcType: 'FLAT', value: 1250, order: 4 },
          { componentId: componentId('SPECIAL'), calcType: 'BALANCE', value: 0, order: 5 },
        ],
      },
    },
    include: { lines: { include: { component: true } } },
  });

  const leadership = await prisma.salaryStructure.create({
    data: {
      organizationId: org.id,
      name: 'Leadership',
      code: 'LEAD',
      description: 'Higher basic, and a performance bonus line',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 50, order: 1 },
          { componentId: componentId('HRA'), calcType: 'PERCENT_OF_BASIC', value: 40, order: 2 },
          { componentId: componentId('CONVEYANCE'), calcType: 'FLAT', value: 3200, order: 3 },
          { componentId: componentId('SPECIAL'), calcType: 'BALANCE', value: 0, order: 4 },
        ],
      },
    },
    include: { lines: { include: { component: true } } },
  });

  const contractStructure = await prisma.salaryStructure.create({
    data: {
      organizationId: org.id,
      name: 'Contract',
      code: 'CONTRACT',
      description: 'Consolidated pay with no allowance split',
      lines: {
        create: [
          { componentId: componentId('BASIC'), calcType: 'PERCENT_OF_CTC', value: 100, order: 1 },
        ],
      },
    },
    include: { lines: { include: { component: true } } },
  });

  const salaryPlan: {
    email: string;
    structure: typeof standard;
    ctc: number;
    tds: number;
    joined: string;
  }[] = [
    {
      email: 'admin@hrms.local',
      structure: leadership,
      ctc: 350_000,
      tds: 62_000,
      joined: `${year - 6}-01-15`,
    },
    {
      email: 'hr@hrms.local',
      structure: leadership,
      ctc: 145_000,
      tds: 14_500,
      joined: `${year - 4}-03-01`,
    },
    {
      email: 'finance@hrms.local',
      structure: leadership,
      ctc: 155_000,
      tds: 16_800,
      joined: `${year - 3}-07-01`,
    },
    {
      email: 'manager@hrms.local',
      structure: standard,
      ctc: 175_000,
      tds: 21_000,
      joined: `${year - 5}-06-10`,
    },
    {
      email: 'asha@hrms.local',
      structure: standard,
      ctc: 78_000,
      tds: 3200,
      joined: `${year - 2}-09-05`,
    },
    {
      email: 'rohan@hrms.local',
      structure: standard,
      ctc: 62_000,
      tds: 1400,
      joined: `${year - 1}-02-17`,
    },
    {
      email: 'zara@hrms.local',
      structure: contractStructure,
      ctc: 34_000,
      tds: 0,
      joined: `${year}-01-08`,
    },
  ];

  for (const plan of salaryPlan) {
    await prisma.employeeSalary.create({
      data: {
        employeeId: emp(plan.email),
        structureId: plan.structure.id,
        effectiveFrom: toDate(plan.joined),
        monthlyCtc: plan.ctc,
        monthlyTds: plan.tds,
        revisionType: 'JOINING',
        reason: 'Salary on joining',
        approvedById: usr('hr@hrms.local'),
      },
    });
  }

  // A raise for two people, so the revision timeline has something to show.
  for (const [email, ctc, type, reason] of [
    ['asha@hrms.local', 92_000, 'PROMOTION', 'Promoted to Senior Software Engineer'],
    ['rohan@hrms.local', 68_000, 'INCREMENT', 'Annual increment'],
  ] as const) {
    await prisma.employeeSalary.create({
      data: {
        employeeId: emp(email),
        structureId: standard.id,
        effectiveFrom: toDate(`${year}-04-01`),
        monthlyCtc: ctc,
        monthlyTds: email === 'asha@hrms.local' ? 5100 : 1900,
        revisionType: type,
        reason,
        approvedById: usr('hr@hrms.local'),
      },
    });
  }

  const now = new Date();
  const thisMonth = dateKey(now).slice(0, 7);
  const monthKey = (back: number) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);

  const payrollConfig = defaultSettings().payroll;
  const round2 = (n: number) => Math.round(n * 100) / 100;

  /*
   * Three settled months, so the runs list, the reports month picker and the
   * salary register all have shape. Payslips are produced by the real engine
   * rather than written by hand — the seed cannot drift away from the code
   * that computes payroll for real.
   */
  for (const back of [3, 2, 1]) {
    const month = monthKey(back);
    const isMostRecent = back === 1;
    const ageDays = back * 30;

    const run = await prisma.payrollRun.create({
      data: {
        organizationId: org.id,
        month,
        status: 'PUBLISHED',
        payDate: toDate(`${monthKey(back - 1)}-01`),
        calculatedAt: shift(-ageDays - 6),
        calculatedById: usr('hr@hrms.local'),
        approvedAt: shift(-ageDays - 5),
        approvedById: usr('finance@hrms.local'),
        lockedAt: shift(-ageDays - 5),
        lockedById: usr('finance@hrms.local'),
        publishedAt: shift(-ageDays - 4),
        publishedById: usr('hr@hrms.local'),
      },
    });

    const totals = { earnings: 0, deductions: 0, employer: 0, net: 0 };

    for (const [index, plan] of salaryPlan.entries()) {
      const employee = await prisma.employee.findUniqueOrThrow({
        where: { id: emp(plan.email) },
        include: {
          department: true,
          designation: true,
          bankDetail: true,
          salaries: {
            where: { effectiveFrom: { lte: toDate(`${month}-28`) } },
            orderBy: { effectiveFrom: 'desc' },
            take: 1,
            include: { structure: { include: { lines: { include: { component: true } } } } },
          },
        },
      });
      const salary = employee.salaries[0];
      if (!salary) continue;

      // A little unpaid leave, spread around, so no two months look alike and
      // the register is not seven identical rows.
      const lopDays = (index + back) % 4 === 0 ? 2 : 0;

      const calc = calculatePayslip({
        month,
        monthlyCtc: Number(salary.monthlyCtc),
        monthlyTds: Number(salary.monthlyTds),
        lines: salary.structure.lines.map((line) => ({
          code: line.component.code,
          name: line.component.name,
          kind: line.component.kind,
          calcType: line.calcType,
          value: Number(line.value),
          order: line.order,
        })),
        lopDays,
        config: payrollConfig,
      });

      /*
       * Older months are fully paid. The most recent one carries a failure and
       * something still pending, so the payment badges, the failure reason and
       * the bulk action bar all have something real to show.
       */
      const payment = !isMostRecent
        ? { status: 'PAID' as const, failureReason: null }
        : index === 2
          ? { status: 'FAILED' as const, failureReason: 'Bank rejected: account name mismatch' }
          : index === 5
            ? { status: 'PENDING' as const, failureReason: null }
            : { status: 'PAID' as const, failureReason: null };

      await prisma.payslip.create({
        data: {
          organizationId: org.id,
          runId: run.id,
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          employeeName: `${employee.firstName} ${employee.lastName}`,
          departmentName: employee.department?.name ?? null,
          designationName: employee.designation?.title ?? null,
          structureName: salary.structure.name,
          bankName: employee.bankDetail?.bankName ?? null,
          accountNumberMasked: employee.bankDetail
            ? `••••${employee.bankDetail.accountNumber.slice(-4)}`
            : null,
          ifsc: employee.bankDetail?.ifscCode ?? null,
          workingDays: calc.workingDays,
          lopDays: calc.lopDays,
          payableDays: calc.payableDays,
          grossEarnings: calc.grossEarnings,
          totalDeductions: calc.totalDeductions,
          employerContribution: calc.employerContribution,
          netPay: calc.netPay,
          carriedShortfall: calc.carriedShortfall,
          paymentStatus: payment.status,
          failureReason: payment.failureReason,
          paidAt: payment.status === 'PAID' ? shift(-ageDays - 3) : null,
          paymentRef:
            payment.status === 'PAID'
              ? `NEFT-${month.replace('-', '')}-${employee.employeeCode}`
              : null,
          lines: {
            create: calc.lines.map((line) => ({
              componentCode: line.code,
              componentName: line.name,
              kind: line.kind,
              amount: line.amount,
              order: line.order,
            })),
          },
        },
      });

      totals.earnings += calc.grossEarnings;
      totals.deductions += calc.totalDeductions;
      totals.employer += calc.employerContribution;
      totals.net += calc.netPay;
    }

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        employeeCount: salaryPlan.length,
        totalEarnings: round2(totals.earnings),
        totalDeductions: round2(totals.deductions),
        totalEmployerCost: round2(totals.employer),
        netPayable: round2(totals.net),
      },
    });
  }

  // The current month sits open, so the workflow has somewhere to start.
  await prisma.payrollRun.create({
    data: {
      organizationId: org.id,
      month: thisMonth,
      status: 'DRAFT',
      payDate: null,
      notes: 'Awaiting month end',
    },
  });

  // ── Settings + audit trail ─────────────────────────────────────────────
  await prisma.setting.create({
    data: {
      organizationId: org.id,
      key: 'workingWeek',
      value: { weekOffDays: [0, 6], weekStartsOn: 1 },
    },
  });
  await prisma.auditLog.createMany({
    data: [
      { action: 'employee.create', entity: 'Employee', entityId: emp('zara@hrms.local') },
      { action: 'leave.request.approved', entity: 'LeaveRequest', entityId: 'seed-leave' },
      { action: 'announcement.create', entity: 'Announcement', entityId: 'seed-announcement' },
      { action: 'org.holiday.create', entity: 'Holiday', entityId: 'seed-holiday' },
      { action: 'settings.update', entity: 'Setting', entityId: 'workingWeek' },
    ].map((a, i) => ({
      organizationId: org.id,
      actorId: usr('hr@hrms.local'),
      createdAt: shift(-i - 1),
      ...a,
    })),
  });

  const counts = {
    employees: await prisma.employee.count({ where: { organizationId: org.id } }),
    attendance: await prisma.attendanceRecord.count({ where: { organizationId: org.id } }),
    leave: await prisma.leaveRequest.count({ where: { employee: { organizationId: org.id } } }),
    announcements: await prisma.announcement.count({ where: { organizationId: org.id } }),
    documents: await prisma.document.count({ where: { organizationId: org.id } }),
  };

  console.log(`
Seed complete — ${org.name}

  ${counts.employees} employees · ${counts.attendance} attendance records
  ${counts.leave} leave requests · ${counts.announcements} announcements · ${counts.documents} documents

  Password for every account: ${PASSWORD}

    admin@hrms.local     Admin     Aarav Shah     CEO — sees everything
    hr@hrms.local        HR        Priya Nair     People ops, org-wide
    finance@hrms.local   Finance   Vikram Rao     Approves and pays payroll
    manager@hrms.local   Manager   Meera Iyer     2 direct reports, approvals
    asha@hrms.local      Employee  Asha Verma     Self service
    rohan@hrms.local     Employee  Rohan Desai    Self service, Pune / early shift
    zara@hrms.local      Employee  Zara Khan      Self service, contract
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
