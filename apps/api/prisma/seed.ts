import 'dotenv/config';
import { DEFAULT_DOCUMENT_CATEGORIES, ROLE_PERMISSIONS, SYSTEM_ROLES } from '@hrms/shared';
import { PrismaPg } from '@prisma/adapter-pg';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@hrms.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe-2026';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  // Organization (single tenant in Phase 1 — ADR §1.3)
  const org = await prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: { name: 'Default Organization', slug: 'default', timezone: 'UTC' },
  });

  // Permission catalog + system roles from @hrms/shared (single source of truth)
  for (const [roleCode, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const meta = SYSTEM_ROLES.find((r) => r.code === roleCode);
    if (!meta) continue;
    const role = await prisma.role.upsert({
      where: { code: roleCode },
      update: { name: meta.name, description: meta.description },
      create: { code: roleCode, name: meta.name, description: meta.description, isSystem: true },
    });
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

  // Bootstrap admin user
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } });
  await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {},
    create: {
      organizationId: org.id,
      email: ADMIN_EMAIL,
      passwordHash: await argon2.hash(ADMIN_PASSWORD, { type: argon2.argon2id }),
      status: 'ACTIVE',
      roleId: adminRole.id,
    },
  });

  // Sensible defaults: employment types + shift + leave types
  const employmentTypes = [
    { name: 'Full-time', code: 'FT' },
    { name: 'Part-time', code: 'PT' },
    { name: 'Contract', code: 'CT' },
    { name: 'Intern', code: 'IN' },
  ];
  for (const et of employmentTypes) {
    await prisma.employmentType.upsert({
      where: { organizationId_name: { organizationId: org.id, name: et.name } },
      update: {},
      create: { organizationId: org.id, ...et },
    });
  }

  await prisma.shift.upsert({
    where: { organizationId_name: { organizationId: org.id, name: 'General' } },
    update: {},
    create: { organizationId: org.id, name: 'General', startTime: '09:00', endTime: '18:00' },
  });
  const leaveTypes = [
    { name: 'Casual Leave', code: 'CL', daysPerYear: 12 },
    { name: 'Sick Leave', code: 'SL', daysPerYear: 8 },
    { name: 'Earned Leave', code: 'EL', daysPerYear: 15, carryForward: true, maxCarryForward: 30 },
  ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({
      where: { organizationId_code: { organizationId: org.id, code: lt.code } },
      update: {},
      create: { organizationId: org.id, ...lt },
    });
  }

  // Document folders (Resume, PAN, Aadhaar…)
  for (const name of DEFAULT_DOCUMENT_CATEGORIES) {
    await prisma.documentCategory.upsert({
      where: { organizationId_name: { organizationId: org.id, name } },
      update: {},
      create: { organizationId: org.id, name },
    });
  }

  console.log(`Seed complete. Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
