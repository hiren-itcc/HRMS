import { expect, mainNav, test } from '../fixtures/test';

/**
 * Golden flow #1 (docs/11-roadmap.md:34) — "all four roles log in and see
 * role-correct nav".
 *
 * The assertion that earns its keep is the *absence*: an Employee must not see
 * Settings. A sidebar that renders everything and lets the API refuse it is a
 * product where every third click is a 403, and no unit test sees the sidebar.
 */
test.describe('sign in', () => {
  test('signs an admin in and lands on the dashboard', async ({ page, signedInAs }) => {
    await signedInAs('admin');
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(mainNav(page).getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('shows an employee their own sections and not the administrative ones', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('asha');
    const nav = mainNav(page);

    await expect(nav.getByRole('link', { name: 'Leave' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Performance' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  });

  test('gives a manager the approvals an employee does not get', async ({ page, signedInAs }) => {
    await signedInAs('manager');
    await page.goto('/performance/team');
    // The tab exists for them at all, which is the permission working.
    await expect(page.getByRole('combobox', { name: /which reviews/i })).toBeVisible();
  });

  test('bounces a signed-out visitor to sign-in and remembers where they were going', async ({
    page,
  }) => {
    await page.goto('/performance');
    await expect(page).toHaveURL(/\/login/);
    // The matcher entry in proxy.ts is what makes this a redirect rather than
    // a blank shell whose every request 401s — the failure five modules shipped
    // with before anybody noticed.
    expect(page.url()).toContain('performance');
  });
});
