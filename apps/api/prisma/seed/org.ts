import { DEFAULT_DOCUMENT_CATEGORIES, DEFAULT_PAY_COMPONENTS } from '@hrms/shared';
import { toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';

export type OrgFixtures = Awaited<ReturnType<typeof seedOrg>>;

/**
 * The scaffolding every other module hangs off: places, departments, job
 * titles, shifts, the holiday calendar, leave types and the pay catalogue.
 *
 * Three locations rather than two, and six departments rather than four, so
 * the department report and the location filter have something to say. Every
 * location carries coordinates: attendance decides office-versus-remote from
 * where a punch happened, and a location off the map makes every day remote.
 */
export async function seedOrg(prisma: PrismaClient, orgId: string, year: number) {
  const locationData = [
    {
      name: 'Ahmedabad HQ',
      type: 'HEAD_OFFICE' as const,
      address: '4th Floor, Titanium One, Prahladnagar',
      city: 'Ahmedabad',
      latitude: 23.0121,
      longitude: 72.5075,
    },
    {
      name: 'Pune Branch',
      type: 'BRANCH' as const,
      address: 'Level 3, Amar Tech Park, Balewadi',
      city: 'Pune',
      latitude: 18.5679,
      longitude: 73.7712,
    },
    {
      name: 'Bengaluru Studio',
      type: 'BRANCH' as const,
      address: '2nd Floor, Prestige Tech Park, Marathahalli',
      city: 'Bengaluru',
      latitude: 12.9548,
      longitude: 77.7009,
    },
  ];
  const locations = await Promise.all(
    locationData.map((l) =>
      prisma.location.create({
        data: {
          organizationId: orgId,
          country: 'India',
          timezone: 'Asia/Kolkata',
          geofenceRadiusMeters: 200,
          ...l,
        },
      }),
    ),
  );
  const location = (name: string) =>
    locations.find((l) => l.name.startsWith(name)) as (typeof locations)[number];

  const engineering = await prisma.department.create({
    data: { organizationId: orgId, name: 'Engineering', code: 'ENG' },
  });
  const peopleOps = await prisma.department.create({
    data: { organizationId: orgId, name: 'People Operations', code: 'HR' },
  });
  const sales = await prisma.department.create({
    data: { organizationId: orgId, name: 'Sales', code: 'SLS' },
  });
  const finance = await prisma.department.create({
    data: { organizationId: orgId, name: 'Finance', code: 'FIN' },
  });
  // Two nested, so the department tree is a tree rather than a list.
  const platform = await prisma.department.create({
    data: { organizationId: orgId, name: 'Platform', code: 'PLT', parentId: engineering.id },
  });
  const quality = await prisma.department.create({
    data: { organizationId: orgId, name: 'Quality', code: 'QA', parentId: engineering.id },
  });

  const designations = await Promise.all(
    [
      { title: 'Chief Executive Officer', level: 10 },
      { title: 'Engineering Manager', level: 7 },
      { title: 'HR Manager', level: 6 },
      { title: 'Finance Manager', level: 6 },
      { title: 'Sales Manager', level: 6 },
      { title: 'Senior Software Engineer', level: 5 },
      { title: 'Software Engineer', level: 4 },
      { title: 'QA Engineer', level: 4 },
      { title: 'Sales Executive', level: 4 },
      { title: 'HR Executive', level: 3 },
      { title: 'Accounts Executive', level: 3 },
      { title: 'Intern', level: 1 },
    ].map((d) => prisma.designation.create({ data: { organizationId: orgId, ...d } })),
  );

  const employmentTypes = await Promise.all(
    [
      { name: 'Full-time', code: 'FT' },
      { name: 'Part-time', code: 'PT' },
      { name: 'Contract', code: 'CT' },
      { name: 'Intern', code: 'IN' },
    ].map((et) => prisma.employmentType.create({ data: { organizationId: orgId, ...et } })),
  );

  const shifts = await Promise.all(
    [
      { name: 'General', startTime: '09:30', endTime: '18:30', graceMinutes: 15 },
      { name: 'Early', startTime: '07:00', endTime: '16:00', graceMinutes: 10 },
      { name: 'Late', startTime: '13:00', endTime: '22:00', graceMinutes: 15 },
    ].map((s) => prisma.shift.create({ data: { organizationId: orgId, ...s } })),
  );

  // This year and next: the leave form refuses a date with no calendar behind
  // it, and somebody booking December leave in November needs next year there.
  const festivals = (y: number) => [
    { name: 'Republic Day', date: toDate(`${y}-01-26`) },
    { name: 'Holi', date: toDate(`${y}-03-14`) },
    { name: 'Independence Day', date: toDate(`${y}-08-15`) },
    { name: 'Gandhi Jayanti', date: toDate(`${y}-10-02`) },
    { name: 'Diwali', date: toDate(`${y}-11-08`) },
    { name: 'Christmas Day', date: toDate(`${y}-12-25`) },
    { name: 'Founders Day', date: toDate(`${y}-09-12`), isOptional: true },
    { name: 'Maharashtra Day', date: toDate(`${y}-05-01`), locationId: location('Pune').id },
  ];
  await prisma.holiday.createMany({
    data: [...festivals(year), ...festivals(year + 1)].map((h) => ({
      organizationId: orgId,
      ...h,
    })),
  });

  const leaveTypes = await Promise.all(
    [
      { name: 'Casual Leave', code: 'CL', daysPerYear: 12 },
      { name: 'Sick Leave', code: 'SL', daysPerYear: 8 },
      // Encashable, so a settlement has something to pay out at the end.
      {
        name: 'Earned Leave',
        code: 'EL',
        daysPerYear: 15,
        carryForward: true,
        maxCarryForward: 30,
        encashable: true,
      },
      { name: 'Unpaid Leave', code: 'LWP', daysPerYear: 0, isPaid: false },
    ].map((lt) => prisma.leaveType.create({ data: { organizationId: orgId, ...lt } })),
  );

  const categories = await Promise.all(
    DEFAULT_DOCUMENT_CATEGORIES.map((name) =>
      prisma.documentCategory.create({ data: { organizationId: orgId, name } }),
    ),
  );

  // isSystem: the calculation engine looks these codes up, so they must exist
  // and must not be deletable.
  const payComponents = await Promise.all(
    DEFAULT_PAY_COMPONENTS.map((c, index) =>
      prisma.payComponent.create({
        data: { organizationId: orgId, ...c, isSystem: true, order: index },
      }),
    ),
  );

  return {
    locations,
    location,
    departments: { engineering, peopleOps, sales, finance, platform, quality },
    designationId: (title: string) => designations.find((d) => d.title === title)?.id,
    employmentTypeId: (code: string) => employmentTypes.find((e) => e.code === code)?.id,
    shiftId: (name: string) => shifts.find((s) => s.name === name)?.id as string,
    leaveTypes,
    leaveTypeId: (code: string) => leaveTypes.find((l) => l.code === code)?.id as string,
    categoryId: (needle: string) =>
      categories.find((c) => c.name.toLowerCase().includes(needle))?.id ?? null,
    componentId: (code: string) => payComponents.find((c) => c.code === code)?.id as string,
  };
}
