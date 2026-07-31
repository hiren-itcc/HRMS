import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
    // Only needed by `migrate diff --from-migrations` (CI drift check) —
    // optional everywhere else.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
