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
   * Anchored, and both halves of that are load-bearing.
   *
   * Not `/password/i`: `PasswordInput` gives its show/hide toggle
   * `aria-label="Show password"`, so a loose match finds two elements and
   * Playwright refuses in strict mode. Anchoring excludes it, because that
   * label starts with "Show".
   *
   * Not exact either. `Field` renders a required marker as an `aria-hidden`
   * asterisk plus an `sr-only` "(required)", so the accessible name really is
   * "Email (required)" — the app is more accessible than an exact match
   * assumes, and `{ exact: true }` matched nothing at all.
   */
  await page.getByLabel(/^Email/).fill(USERS[user]);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(mainNav(page)).toBeVisible({ timeout: 20_000 });
}

/**
 * The one navigation that is actually on screen.
 *
 * `SidebarNav` is rendered twice — once by `AppSidebar` for the rail and once
 * by `app-header` inside the mobile drawer — so `getByRole('navigation')`
 * matches two elements and `.first()` picks whichever comes first in the DOM,
 * which is the hidden one. That is why every signed-in assertion timed out
 * waiting for something "visible" that was never going to be.
 *
 * `:visible` picks the rendered one at whatever width the test runs at, and
 * scoping link queries through it stops the same duplication biting again on
 * every nav item.
 */
export function mainNav(page: Page) {
  return page.locator('nav[aria-label="Main"]:visible').first();
}

export const test = base.extend<{ signedInAs: (user: SeededUser) => Promise<void> }>({
  signedInAs: async ({ page }, use) => {
    await use((user: SeededUser) => signIn(page, user));
  },
});

export { expect } from '@playwright/test';
