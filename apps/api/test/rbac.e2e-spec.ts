import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, createTestApp, login } from './app';

/**
 * The permission matrix, against the real guard and the real seeded grants.
 *
 * This is the layer the unit suite structurally cannot reach: `PermissionsGuard`
 * reads `RolePermission` rows, so "does an Employee actually get a 403 here"
 * is a question about the database, not about a mocked Prisma. It is also the
 * wrong job for a browser — proving a manager is refused an org-wide list is
 * one second here and a login plus a page load in Playwright.
 *
 * The seeded accounts are the fixtures. They are stable by design: the seed is
 * deterministic, and its banner names exactly these five.
 */
describe('RBAC across roles', () => {
  let app: INestApplication;
  const token: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    for (const [role, email] of [
      ['admin', 'admin@hrms.local'],
      ['hr', 'hr@hrms.local'],
      ['finance', 'finance@hrms.local'],
      ['manager', 'manager@hrms.local'],
      ['employee', 'asha@hrms.local'],
    ] as const) {
      token[role] = await login(app, email);
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  const get = (path: string, role: string) =>
    request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set(as(token[role] as string));

  describe('performance', () => {
    it('lets every role reach their own reviews', async () => {
      for (const role of ['admin', 'hr', 'finance', 'manager', 'employee']) {
        const res = await get('/performance/reviews?scope=own', role);
        expect([res.status, role]).toEqual([200, role]);
      }
    });

    it('refuses cycle administration to everybody but Admin and HR', async () => {
      for (const role of ['finance', 'manager', 'employee']) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/performance/cycles')
          .set(as(token[role] as string))
          .send({
            name: `Should not exist ${role}`,
            periodStart: '2027-01-01',
            periodEnd: '2027-06-30',
          });
        expect([res.status, role]).toEqual([403, role]);
      }
    });

    /*
     * The one that matters most, and the one a status code alone would miss:
     * an employee asking for the whole organization gets 200, because the
     * service *narrows* rather than refusing — so the assertion has to be about
     * the rows, not the code. A `where` clause that silently became `{}` would
     * pass a status check and leak the company.
     */
    it('narrows an employee asking for scope=all rather than refusing them', async () => {
      const mine = await get('/performance/reviews?scope=own', 'employee');
      const all = await get('/performance/reviews?scope=all', 'employee');

      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(mine.body.data.length);
      expect(all.body.meta.total).toBe(mine.body.meta.total);
    });

    it('gives HR more than it gives one employee', async () => {
      const hr = await get('/performance/reviews?scope=all', 'hr');
      const employee = await get('/performance/reviews?scope=all', 'employee');
      expect(hr.body.meta.total).toBeGreaterThan(employee.body.meta.total);
    });
  });

  describe('payroll separation of duties', () => {
    /* HR configures and processes; Finance approves and pays. Nobody holds
       both by default, and that is the point rather than an accident. */
    it('keeps HR out of approving and Finance out of salary structures', async () => {
      const hrPerms = (await get('/auth/me', 'hr')).body.permissions as string[];
      const finPerms = (await get('/auth/me', 'finance')).body.permissions as string[];

      expect(hrPerms).toContain('payroll.process');
      expect(hrPerms).not.toContain('payroll.approve');
      expect(finPerms).toContain('payroll.approve');
      expect(finPerms).not.toContain('payroll.salary.manage');
    });
  });

  describe('scoped reads answer 404 rather than 403', () => {
    /*
     * Whether a record exists is itself information about a person. A 403
     * confirms it where a 404 does not, which is why every scoped detail route
     * here answers "not found" for something that exists but is not yours.
     */
    it('hides another employee’s review behind a 404', async () => {
      const all = await get('/performance/reviews?scope=all', 'hr');
      const mine = await get('/performance/reviews?scope=own', 'employee');
      const mineIds = new Set((mine.body.data as { id: string }[]).map((r) => r.id));
      const someoneElse = (all.body.data as { id: string }[]).find((r) => !mineIds.has(r.id));

      expect(someoneElse).toBeDefined();
      const res = await get(`/performance/reviews/${someoneElse?.id}`, 'employee');
      expect(res.status).toBe(404);
    });
  });
});
