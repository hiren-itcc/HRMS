import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MAIL_TRANSPORT } from '../src/modules/mail/transport';
import { createTestApp, SEED_PASSWORD } from './app';

/**
 * The endpoint whose whole job is to answer identically whether or not an
 * address belongs to an account.
 *
 * It did not, in production, and the shape of that failure is why this file
 * exists rather than a sixth browser flow. `forgotPassword` let a refused mail
 * send throw, so a real account answered 500 and an unknown address answered
 * 200 — enumeration by status code, on an unauthenticated endpoint whose own
 * Swagger summary promises the response never reveals it.
 *
 * **A Playwright spec would not have caught this, even aimed straight at it.**
 * The failure needs a *failing transport*, and in any environment without a
 * mail key the transport is `LogTransport`, which never throws: both addresses
 * answer 200 and the test passes. The bug is invisible in exactly the
 * environment end-to-end tests run in.
 *
 * So the assertion is made the only way that works — inject a transport that
 * rejects, then require the two responses to be **identical**, status and body.
 * The general rule, worth applying to anything else that promises
 * indistinguishability: assert the equality of two responses under an injected
 * failure, not the success of one.
 */
describe('POST /auth/forgot-password (enumeration)', () => {
  let app: INestApplication;

  const post = (email: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });

  afterEach(async () => {
    await app?.close();
  });

  it('answers a real address and an unknown one identically', async () => {
    app = await createTestApp();

    const real = await post('admin@hrms.local');
    const unknown = await post('nobody@nowhere.invalid');

    expect(real.status).toBe(unknown.status);
    expect(real.body).toEqual(unknown.body);
  });

  /*
   * The regression test proper. Everything above passes on a healthy transport;
   * only this one fails if the try/catch in `forgotPassword` is ever removed.
   */
  it('stays identical when the mail transport refuses', async () => {
    app = await createTestApp([
      [
        MAIL_TRANSPORT,
        {
          send: async () => {
            // Exactly what ResendTransport throws when a domain is unverified,
            // which is the failure that was live in production.
            throw new Error('Email could not be sent: domain not verified');
          },
        },
      ],
    ]);

    const real = await post('admin@hrms.local');
    const unknown = await post('nobody@nowhere.invalid');

    expect(real.status).toBe(unknown.status);
    expect(real.body).toEqual(unknown.body);
    // Named explicitly, because "identical" would also be satisfied by both
    // returning 500 — which is a different bug, not a fix.
    expect(real.status).toBeLessThan(400);
  });
});

describe('POST /auth/login', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('signs a seeded account in and returns permission claims', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@hrms.local', password: SEED_PASSWORD });

    expect(res.status).toBeLessThan(300);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user.permissions).toContain('performance.manage');
  });

  /* A wrong password and an address with no account must be indistinguishable
     from outside, the same property forgot-password has. */
  it('answers a wrong password and an unknown address the same way', async () => {
    const wrong = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'admin@hrms.local', password: 'Not-The-Password1' });
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.invalid', password: 'Not-The-Password1' });

    expect(wrong.status).toBe(unknown.status);
    expect(wrong.body.message).toEqual(unknown.body.message);
  });
});

/**
 * The rate limits, which had no test at all until the end-to-end suite ran into
 * them — nine sign-ins across five browser specs from one CI IP, against five a
 * minute, and 429s cascading through four of them.
 *
 * Testing it here rather than there is the point: the browser specs exist to
 * test the product, and a control is better proved once, cheaply, than fought
 * by everything else.
 */
describe('auth rate limiting', () => {
  let app: INestApplication;

  /* Whatever the environment is configured for, rather than a magic 5 — the
     test proves the mechanism, not a number somebody may legitimately change. */
  const limit = Number(process.env.AUTH_THROTTLE_LIMIT ?? 5);

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  it('refuses sign-in past the configured limit', async () => {
    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@nowhere.invalid', password: 'Not-The-Password1' });

    let refused = false;
    // One past the limit: the last is the one that must be turned away.
    for (let i = 0; i <= limit; i += 1) {
      const res = await attempt();
      if (res.status === 429) refused = true;
    }
    expect(refused).toBe(true);
  });

  /*
   * The regression test for the split, and the thing that catches somebody
   * merging the two throttle consts back into one.
   *
   * Refresh is called on every app bootstrap and again on any 401, so sharing
   * the sign-in bucket meant a signed-in person who reloaded a few times, or
   * shared an office IP, was thrown back to the login screen. It is guarded by
   * rotation and reuse detection instead, which a per-IP counter does not
   * improve on.
   *
   * No cookie is sent, so every one of these is a legitimate 401 — what is
   * being asserted is that none of them is a 429.
   */
  it('does not apply the sign-in limit to refresh', async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= limit + 2; i += 1) {
      const res = await request(app.getHttpServer()).post('/api/v1/auth/refresh');
      statuses.push(res.status);
    }
    expect(statuses).not.toContain(429);
  });
});
