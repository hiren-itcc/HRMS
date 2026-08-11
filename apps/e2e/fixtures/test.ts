import { test as base, expect, type Page } from '@playwright/test';

export const PASSWORD = process.env.SEED_PASSWORD ?? 'Passw0rd!2026';

/** The seeded accounts, from the seed's own banner. */
export const USERS = {
  admin: 'admin@hrms.local',
  hr: 'hr@hrms.local',
  finance: 'finance@hrms.local',
  manager: 'manager@hrms.local',
  /** Deliberately unmarked today — spec 02 owns this one. */
  asha: 'asha@hrms.local',
  rohan: 'rohan@hrms.local',
} as const;

export type SeededUser = keyof typeof USERS;

/**
 * Sign in through the real form.
 *
 * Not `storageState`, and that is the considered choice rather than the lazy
 * one. The access token lives **in memory only** — `api-client.ts` says so —
 * so a restored session is a refresh cookie on the API origin plus a marker
 * cookie on the web origin, and it only becomes authenticated after the first
 * 401 triggers a refresh. Refresh tokens rotate with reuse detection, so two
 * contexts replaying one saved cookie revoke each other.
 *
 * Signing in per context costs about a second and removes that entire class of
 * failure, which would otherwise look like flake and be debugged as flake.
 */
export async function signIn(page: Page, user: SeededUser): Promise<void> {
  await page.goto('/login');
  /*
   * Exact labels, not a regex. `PasswordInput` gives its show/hide toggle
   * `aria-label="Show password"`, so `getByLabel(/password/i)` matches two
   * elements and Playwright refuses in strict mode — which is what the first
   * CI run of this suite reported, and the correct answer is a precise
   * selector rather than `.first()`.
   */
  await page.getByLabel('Email', { exact: true }).fill(USERS[user]);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  /*
   * Wait on something only a signed-in page has, not on the URL: the address
   * bar is correct before the app is ready, because a session becomes
   * authenticated on the client only after the first refresh completes.
   *
   * `.first()` because the sidebar renders as both a drawer and a rail
   * depending on width, and either may be in the tree.
   */
  await expect(page.getByRole('navigation', { name: 'Main' }).first()).toBeVisible({
    timeout: 20_000,
  });
}

export const test = base.extend<{ signedInAs: (user: SeededUser) => Promise<void> }>({
  signedInAs: async ({ page }, use) => {
    await use((user: SeededUser) => signIn(page, user));
  },
});

export { expect } from '@playwright/test';
