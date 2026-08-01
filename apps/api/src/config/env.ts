import { z } from 'zod';

/**
 * Environment contract — the app refuses to boot on missing/invalid env
 * (docs/07-auth-architecture.md hardening checklist).
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  /**
   * Number of reverse proxies in front of the API, or 0 when it is exposed
   * directly.
   *
   * Express only reads `X-Forwarded-For` when this is set, and that header is
   * trivially forged — so trusting it while directly exposed would let anyone
   * choose the IP that the login rate limit counts against and that the audit
   * log records. Off by default; set it to the number of hops you actually
   * have (1 behind a single load balancer).
   */
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * Password a newly created employee's login starts with.
   *
   * A shared starting password is only safe because the account is flagged
   * `mustChangePassword` — the holder cannot do anything until they set their
   * own. Change it per deployment anyway: it is the one credential that is
   * predictable by design.
   */
  DEFAULT_USER_PASSWORD: z.string().min(8).default('Welcome@2026'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${parsed.error.message}`);
  }
  return parsed.data;
}
