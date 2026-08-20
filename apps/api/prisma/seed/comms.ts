import {
  defaultSettings,
  emailTemplateDefault,
  exitChecklistSchema,
  letterTemplateDefault,
} from '@hrms/shared';
import { addDays, toDate } from '../../src/common/utils/calendar';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { bodyContainsSalary, buildLetterVars } from '../../src/modules/letters/letter-vars';
import { render } from '../../src/modules/mail/template-renderer';
import type { OrgFixtures } from './org';
import type { People } from './people';
import type { Random } from './random';

/**
 * Everything that talks to a person: announcements, their documents, the
 * letters they were issued, the bell, and the settings and audit trail behind
 * all of it.
 */
export async function seedComms(
  prisma: PrismaClient,
  orgId: string,
  orgName: string,
  org: OrgFixtures,
  people: People,
  random: Random,
  todayKey: string,
): Promise<void> {
  const hrUser = people.usr('hr@hrms.local');
  const adminUser = people.usr('admin@hrms.local');

  // ── Announcements ──────────────────────────────────────────────────────
  const announcements = [
    {
      title: 'Payroll cut-off moves to the 22nd',
      body: 'Timesheets and expense claims must be submitted by the **22nd** this month.\n\nAnything later moves to the following cycle.',
      category: 'GENERAL' as const,
      priority: 'URGENT' as const,
      isPinned: true,
      author: adminUser,
      publishIn: -1,
    },
    {
      title: 'Diwali holiday schedule',
      body: 'The office is **closed 8–10 November**. No attendance is required and no leave is deducted.\n\nOn-call rotas are unchanged — please check the roster.',
      category: 'HOLIDAY' as const,
      priority: 'NORMAL' as const,
      isPinned: true,
      author: hrUser,
      publishIn: -3,
    },
    {
      title: 'Updated leave policy — earned leave carry-forward',
      body: 'From this leave year, up to **30 days** of Earned Leave may be carried forward.\n\nAnything above the cap lapses at year end, so please plan with your manager.',
      category: 'POLICY' as const,
      priority: 'HIGH' as const,
      isPinned: false,
      author: hrUser,
      publishIn: -5,
    },
    {
      title: 'Work from home policy — two days a week',
      body: 'Remote days are now booked in advance under **Attendance → Remote work**, up to two days a week.\n\nYour manager sees the request the moment you file it.',
      category: 'POLICY' as const,
      priority: 'NORMAL' as const,
      isPinned: false,
      author: hrUser,
      publishIn: -8,
    },
    {
      title: 'Office closed for maintenance this Saturday',
      body: 'Building maintenance is replacing the chillers. The Ahmedabad office is **shut all day Saturday**.',
      category: 'GENERAL' as const,
      priority: 'HIGH' as const,
      isPinned: false,
      author: adminUser,
      // Scheduled, not yet visible — the publish date is what hides it.
      publishIn: 4,
    },
    {
      title: 'Birthdays and anniversaries this month',
      body: 'The dashboard now lists them. Cake in the pantry at 4pm on the day, as ever.',
      category: 'BIRTHDAY' as const,
      priority: 'NORMAL' as const,
      isPinned: false,
      author: adminUser,
      publishIn: -11,
    },
  ];

  for (const [index, a] of announcements.entries()) {
    const row = await prisma.announcement.create({
      data: {
        organizationId: orgId,
        title: a.title,
        body: a.body,
        category: a.category,
        priority: a.priority,
        audience: 'ALL',
        isPinned: a.isPinned,
        publishAt: toDate(addDays(todayKey, a.publishIn)),
        authorId: a.author,
      },
    });

    if (index === 1) {
      await prisma.announcementAttachment.create({
        data: {
          announcementId: row.id,
          name: 'Diwali-rota.pdf',
          fileKey: `seed/${orgId}/diwali-rota.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: 48_120,
        },
      });
    }
    // A few reads, so the receipts view has something to show.
    if (index < 3) {
      await prisma.announcementRead.createMany({
        data: people.staff.slice(0, 9).map((p) => ({ announcementId: row.id, userId: p.userId })),
        skipDuplicates: true,
      });
    }
  }

  // ── Documents: metadata only — a seed has no object storage behind it ───
  const docs = people.all.flatMap((person, i) => {
    const set = [
      { name: `${person.firstName} ${person.lastName} — Resume.pdf`, cat: 'resume' },
      { name: 'Offer Letter.pdf', cat: 'offer' },
    ];
    if (i % 3 === 0) set.push({ name: 'PAN card.pdf', cat: 'identity' });
    return set.map((d, n) => ({
      organizationId: orgId,
      employeeId: person.employeeId,
      categoryId: org.categoryId(d.cat),
      name: d.name,
      fileKey: `seed/${orgId}/${person.code}-${n}-${d.name.replace(/\s+/g, '-').toLowerCase()}`,
      mimeType: 'application/pdf',
      sizeBytes: random.int(60_000, 400_000),
      uploadedById: hrUser,
    }));
  });
  await prisma.document.createMany({ data: docs });

  // ── Letters ────────────────────────────────────────────────────────────
  // One customised template, so Settings → Letters shows an override rather
  // than four untouched defaults.
  const appointment = letterTemplateDefault('appointment_letter');
  if (appointment) {
    await prisma.letterTemplate.create({
      data: {
        organizationId: orgId,
        key: appointment.key,
        title: appointment.title,
        bodyHtml: appointment.bodyHtml.replace(
          '</p>',
          '</p>\n<p>We are glad to have you with us.</p>',
        ),
      },
    });
  }

  const issuedBy = `${people.byEmail('hr@hrms.local').firstName} ${people.byEmail('hr@hrms.local').lastName}`;
  let letterNumber = 1;

  const issue = async (input: {
    email: string;
    templateKey: string;
    voided?: boolean;
    issuedBack: number;
  }) => {
    const template = letterTemplateDefault(input.templateKey);
    if (!template) return;
    const person = people.byEmail(input.email);
    const employee = await prisma.employee.findUniqueOrThrow({
      where: { id: person.employeeId },
      include: {
        department: true,
        designation: true,
        location: true,
        employmentType: true,
        manager: true,
      },
    });

    const issueDate = toDate(addDays(todayKey, -input.issuedBack));
    const number = `${template.key.slice(0, 3).toUpperCase()}/${todayKey.slice(0, 4)}/${String(letterNumber++).padStart(4, '0')}`;
    const vars = buildLetterVars(employee, {
      orgName,
      letterNumber: number,
      issuedByName: issuedBy,
      issueDate,
      monthlyCtc: person.monthlyCtc,
    });

    await prisma.letter.create({
      data: {
        organizationId: orgId,
        employeeId: person.employeeId,
        templateKey: template.key,
        letterNumber: number,
        title: render(template.title, vars),
        bodyHtml: render(template.bodyHtml, vars),
        employeeCode: employee.employeeCode,
        employeeName: `${employee.firstName} ${employee.lastName}`,
        departmentName: employee.department?.name ?? null,
        designationName: employee.designation?.title ?? null,
        joinDate: employee.joinDate,
        exitDate: employee.exitDate,
        monthlyCtc: person.monthlyCtc,
        containsSalary: bodyContainsSalary(template, template.bodyHtml),
        variables: vars as object,
        status: input.voided ? 'VOID' : 'ISSUED',
        issuedAt: issueDate,
        issuedById: hrUser,
        ...(input.voided
          ? {
              voidedAt: toDate(addDays(todayKey, -input.issuedBack + 2)),
              voidedById: hrUser,
              voidReason: 'Wrong designation printed — reissued.',
            }
          : {}),
      },
    });
  };

  await issue({ email: 'asha@hrms.local', templateKey: 'offer_letter', issuedBack: 400 });
  await issue({ email: 'asha@hrms.local', templateKey: 'appointment_letter', issuedBack: 395 });
  await issue({ email: 'rohan@hrms.local', templateKey: 'salary_certificate', issuedBack: 30 });
  await issue({
    email: 'zara@hrms.local',
    templateKey: 'offer_letter',
    issuedBack: 200,
    voided: true,
  });
  // Leavers get the two letters an exit produces.
  for (const person of people.all.filter((p) => p.status === 'EXITED').slice(0, 2)) {
    await issue({ email: person.email, templateKey: 'relieving_letter', issuedBack: 15 });
    await issue({ email: person.email, templateKey: 'experience_letter', issuedBack: 14 });
  }

  // ── The bell ───────────────────────────────────────────────────────────
  const bell = [
    {
      type: 'leave.requested',
      title: 'Asha Verma asked for 3 days of casual leave',
      linkPath: '/leave/approvals',
    },
    {
      type: 'wfh.requested',
      title: 'Rohan Desai asked to work remotely next week',
      linkPath: '/attendance/remote',
    },
    {
      type: 'attendance.requested',
      title: 'An attendance correction needs your decision',
      linkPath: '/attendance/approvals',
    },
    {
      type: 'resignation.submitted',
      title: 'A resignation is waiting on you',
      linkPath: '/resignations/approvals',
    },
    {
      type: 'payroll.review',
      title: 'Last month’s payroll run is ready for review',
      linkPath: '/payroll',
    },
  ];
  await prisma.notification.createMany({
    data: [people.usr('manager@hrms.local'), hrUser, adminUser].flatMap((userId) =>
      bell.map((n, i) => ({
        userId,
        type: n.type,
        title: n.title,
        linkPath: n.linkPath,
        createdAt: toDate(addDays(todayKey, -i)),
        // The two oldest already read, so the badge is a count and not a dot.
        readAt: i > 2 ? toDate(addDays(todayKey, -i)) : null,
      })),
    ),
  });

  // ── Settings ───────────────────────────────────────────────────────────
  const defaults = defaultSettings();
  await prisma.setting.createMany({
    data: [
      { key: 'workingWeek', value: { weekOffDays: [0, 6], weekStartsOn: 1 } },
      { key: 'wfh', value: defaults.wfh as object },
      // Saved explicitly, with ASSET_RETURN left on: a fresh organization gets
      // the computed asset gate, and this workspace should demonstrate it
      // rather than sit on the MANUAL fallback kept for older tenants.
      { key: 'exitChecklist', value: exitChecklistSchema.parse({}) as object },
      { key: 'settlement', value: defaults.settlement as object },
    ].map((s) => ({ organizationId: orgId, ...s })),
  });

  const invite = emailTemplateDefault('employee_invite');
  if (invite) {
    await prisma.emailTemplate.create({
      data: {
        organizationId: orgId,
        key: invite.key,
        subject: `Welcome to ${orgName} — set your password`,
        bodyHtml: invite.bodyHtml,
        isActive: true,
      },
    });
  }

  // ── Audit trail ────────────────────────────────────────────────────────
  const actions = [
    { action: 'employee.create', entity: 'Employee' },
    { action: 'leave.request.approved', entity: 'LeaveRequest' },
    { action: 'announcement.create', entity: 'Announcement' },
    { action: 'org.holiday.create', entity: 'Holiday' },
    { action: 'settings.update', entity: 'Setting' },
    { action: 'payroll.run.published', entity: 'PayrollRun' },
    { action: 'asset.issue', entity: 'Asset' },
    { action: 'resignation.approved', entity: 'Resignation' },
    { action: 'settlement.paid', entity: 'Settlement' },
    { action: 'letter.issue', entity: 'Letter' },
  ];
  await prisma.auditLog.createMany({
    data: actions.map((a, i) => ({
      organizationId: orgId,
      actorId: i % 2 === 0 ? hrUser : adminUser,
      createdAt: toDate(addDays(todayKey, -i - 1)),
      entityId: `seed-${a.entity.toLowerCase()}`,
      ...a,
    })),
  });
}
