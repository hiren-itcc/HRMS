import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // `prisma/seed/index.ts`, not `prisma/seed.ts` — the seed became a
    // directory and this line did not follow it, so `prisma db seed` has been
    // failing on a missing file while `pnpm db:seed` (which names the real
    // path) worked. Nothing noticed because nothing in CI seeds yet.
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Only needed by `migrate diff --from-migrations` (CI drift check) —
    // optional everywhere else.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
