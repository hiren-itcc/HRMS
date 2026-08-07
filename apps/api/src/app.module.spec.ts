import { Test } from '@nestjs/testing';
import { PrismaService } from './database/prisma.service';

/**
 * The whole dependency graph resolves.
 *
 * Worth a test of its own because a Nest module cycle is a *runtime* failure —
 * it typechecks, every unit test passes, and the app then refuses to boot. The
 * exit feature introduced the first `forwardRef` in the codebase
 * (Resignations ↔ Offboarding) and three new modules around it, and the
 * unit specs construct services by hand, so nothing else here would notice.
 *
 * Environment is set in the body rather than by a setup file: `validateEnv`
 * runs when ConfigModule is instantiated, not at import, so this stays
 * self-contained and needs nothing from CI.
 */
it('resolves every provider in AppModule', async () => {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/db';
  process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(32);
  process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(32);
  process.env.WEB_ORIGIN ??= 'http://localhost:3000';

  // `require` rather than a dynamic import: this has to happen *after* the
  // environment is set, and a static import would be hoisted above it.
  const { AppModule } = jest.requireActual<typeof import('./app.module')>('./app.module');
  const ref = await Test.createTestingModule({ imports: [AppModule] })
    // The only thing that would reach outside the process.
    .overrideProvider(PrismaService)
    .useValue({ $connect: jest.fn(), $disconnect: jest.fn() })
    .compile();

  expect(ref.get(AppModule)).toBeDefined();
  await ref.close();
});
