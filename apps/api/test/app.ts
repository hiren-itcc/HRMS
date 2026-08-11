import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * A real Nest application over a real Postgres, built once per spec file.
 *
 * Deliberately the whole `AppModule` rather than a trimmed one: the guards are
 * most of what these tests exist to check, and a testing module that leaves
 * them out proves nothing about the pipeline a request actually goes through.
 */
export async function createTestApp(
  /**
   * Providers to swap, as `[token, value]` pairs. The only current use is
   * injecting a mail transport that refuses — which is the sole way to
   * reproduce the enumeration bug, since a healthy transport hides it.
   */
  overrides: [unknown, unknown][] = [],
): Promise<INestApplication> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const [token, value] of overrides) {
    builder = builder.overrideProvider(token).useValue(value);
  }
  const app = (await builder.compile()).createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.init();
  return app;
}

export const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!2026';

/** An access token for a seeded account, via the real login route. */
export async function login(app: INestApplication, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: SEED_PASSWORD });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Could not sign in as ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.accessToken;
}

export const as = (token: string) => ({ Authorization: `Bearer ${token}` });
