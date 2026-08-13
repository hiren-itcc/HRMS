import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, createTestApp, login } from './app';

/**
 * Does an audit row actually come out with an address on it?
 *
 * The unit tests pin both writers against a fake Prisma, which proves the
 * `create` carries an `ip` but not that anything ever puts one in the store.
 * That part is middleware, `AsyncLocalStorage` and Express's `req.ip` — three
 * things a mock cannot speak for. This drives a real mutation over HTTP and
 * reads the row back through the real audit endpoint.
 *
 * It also covers the reason the middleware is registered in `AppModule` rather
 * than `main.ts`: this harness builds the app straight from `AppModule`, so a
 * bootstrap-only wiring would leave the store empty here and the test would
 * fail — which is the behaviour worth locking in, since the same would be true
 * of any other entrypoint.
 */

const ADMIN = 'admin@hrms.local';

describe('audit rows record where the change came from', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await login(app, ADMIN);
  });

  afterAll(async () => {
    await app?.close();
  });

  /*
   * A department, created and then removed, so the suite leaves the database as
   * it found it. It also exercises `auditOrgMutation` — the helper that kept
   * its own copy of the insert — rather than the shared writer the unit tests
   * already cover directly.
   */
  it('puts the client address on a row written through an org mutation', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/organization/departments')
      .set(as(admin))
      .send({ name: 'Audit IP Probe', code: 'AIP' })
      .expect(201);

    const departmentId = created.body.id as string;
    expect(typeof departmentId).toBe('string');

    try {
      const trail = await request(app.getHttpServer())
        .get(`/api/v1/audit?entityId=${departmentId}`)
        .set(as(admin))
        .expect(200);

      const rows = trail.body.data as { action: string; ip: string | null }[];
      expect(rows.length).toBeGreaterThan(0);

      /*
       * Loopback, because supertest connects over one — the assertion that
       * matters is "not null". Before this change every row *except* a sign-in
       * event was null, so a real address on a department is the whole result.
       */
      const [row] = rows;
      expect({ action: row?.action, hasIp: row?.ip !== null && row?.ip !== undefined }).toEqual({
        action: 'org.department.create',
        hasIp: true,
      });

      // Normalised on the way in: `::ffff:127.0.0.1` is what Node reports on a
      // dual-stack socket, and it is not what belongs in a column people read.
      expect(row?.ip).toBe('127.0.0.1');
    } finally {
      await request(app.getHttpServer())
        .delete(`/api/v1/organization/departments/${departmentId}`)
        .set(as(admin))
        .expect(204);
    }
  });
});
