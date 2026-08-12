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

  describe('helpdesk', () => {
    it('lets every role reach the tickets they raised', async () => {
      for (const role of ['admin', 'hr', 'finance', 'manager', 'employee']) {
        const res = await get('/helpdesk/tickets?scope=own', role);
        expect([res.status, role]).toEqual([200, role]);
      }
    });

    it('refuses desk administration to everybody but Admin and HR', async () => {
      for (const role of ['finance', 'manager', 'employee']) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/helpdesk/categories')
          .set(as(token[role] as string))
          .send({ name: `Should not exist ${role}` });
        expect([res.status, role]).toEqual([403, role]);
      }
    });

    /*
     * The assertion that has to be about the rows rather than the status code,
     * for the same reason the performance one above does: asking for the whole
     * organization returns 200 because the service narrows, so a `where` clause
     * that silently became `{}` would sail through a status check and hand one
     * employee every grievance in the company.
     */
    it('narrows an employee asking for scope=all rather than refusing them', async () => {
      const mine = await get('/helpdesk/tickets?scope=own', 'employee');
      const all = await get('/helpdesk/tickets?scope=all', 'employee');

      expect(all.status).toBe(200);
      expect(all.body.data).toHaveLength(mine.body.data.length);
      expect(all.body.meta.total).toBe(mine.body.meta.total);
    });

    /* Same again for the queue, which is the scope somebody might reasonably
       expect to be public within the company. It is not. */
    it('narrows an employee asking for the queue', async () => {
      const mine = await get('/helpdesk/tickets?scope=own', 'employee');
      const queue = await get('/helpdesk/tickets?scope=queue', 'employee');
      expect(queue.body.meta.total).toBe(mine.body.meta.total);
    });

    it('gives HR more than it gives one employee', async () => {
      const hr = await get('/helpdesk/tickets?scope=all', 'hr');
      const employee = await get('/helpdesk/tickets?scope=all', 'employee');
      expect(hr.body.meta.total).toBeGreaterThan(employee.body.meta.total);
    });

    /*
     * The module's sharpest edge, end to end. The seed puts an internal note on
     * a ticket Asha raised; she must not see it, and HR must. A unit test pins
     * the filter, but only this proves the filter is actually reached by the
     * route that renders a thread.
     */
    it('keeps an internal note away from the person who raised the ticket', async () => {
      const mine = await get('/helpdesk/tickets?scope=own', 'employee');
      const withNote = (mine.body.data as { id: string; subject: string }[]).find((t) =>
        t.subject.includes('reimbursement'),
      );
      expect(withNote).toBeDefined();

      const asEmployee = await get(`/helpdesk/tickets/${withNote?.id}`, 'employee');
      const asHr = await get(`/helpdesk/tickets/${withNote?.id}`, 'hr');

      const kinds = (res: { body: { comments: { kind: string }[] } }) =>
        res.body.comments.map((c) => c.kind);
      expect(kinds(asEmployee)).not.toContain('INTERNAL');
      expect(kinds(asHr)).toContain('INTERNAL');
      expect(JSON.stringify(asEmployee.body)).not.toContain('Do not promise a date');
    });

    /* Whether a ticket exists is itself information. */
    it('answers 404 rather than 403 for a ticket somebody cannot reach', async () => {
      const hrTickets = await get('/helpdesk/tickets?scope=all', 'hr');
      const someone = (hrTickets.body.data as { id: string; requester: { name: string } }[]).find(
        (t) => !t.requester.name.includes('Asha'),
      );
      expect(someone).toBeDefined();
      const res = await get(`/helpdesk/tickets/${someone?.id}`, 'employee');
      expect(res.status).toBe(404);
    });
  });

  describe('tds', () => {
    it('lets HR and Finance read the challan register', async () => {
      for (const role of ['admin', 'hr', 'finance']) {
        const res = await get('/payroll/challans', role);
        expect([res.status, role]).toEqual([200, role]);
      }
    });

    it('refuses the register to a manager and an employee', async () => {
      for (const role of ['manager', 'employee']) {
        const res = await get('/payroll/challans', role);
        expect([res.status, role]).toEqual([403, role]);
      }
    });

    it('refuses recording a deposit to everybody without payroll.filing', async () => {
      for (const role of ['manager', 'employee']) {
        const res = await request(app.getHttpServer())
          .post('/api/v1/payroll/challans')
          .set(as(token[role] as string))
          .send({
            period: '2026-07',
            bsrCode: '0510308',
            challanSerial: '00123',
            depositDate: '2026-08-07',
            tds: 1,
          });
        expect([res.status, role]).toEqual([403, role]);
      }
    });

    /*
     * What only this layer can prove: that the seeded RolePermission rows
     * really do grant `payroll.filing`, against the real guard rather than a
     * mocked Prisma. Round-tripping a write through a read is the assertion —
     * a 201 alone would pass even if the row never reached the register.
     *
     * Cross-tenant isolation is deliberately NOT tested here: the suite seeds
     * one organization, so there is no second tenant to leak to and any test
     * claiming otherwise would be theatre. That scoping is asserted in
     * `tds-challans.service.spec.ts`, which checks the `where` clause itself.
     */
    it('round-trips a deposit HR records into the register', async () => {
      const period = '2026-05';
      const created = await request(app.getHttpServer())
        .post('/api/v1/payroll/challans')
        .set(as(token.hr as string))
        .send({
          period,
          bsrCode: '0510308',
          challanSerial: '99001',
          depositDate: '2026-06-07',
          tds: 4242,
        });
      expect(created.status).toBe(201);

      const listed = await get('/payroll/challans', 'hr');
      expect(listed.status).toBe(200);
      expect(listed.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ period, tds: 4242 })]),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/payroll/challans/${created.body.id}`)
        .set(as(token.hr as string));
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
