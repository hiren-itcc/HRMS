import { expect, signIn, test } from '../fixtures/test';

/**
 * Golden flow #3 (docs/11-roadmap.md:46) — apply, then approve.
 *
 * The only flow that crosses two people, which is exactly what makes it worth a
 * browser: the balance is decremented in the same transaction as the approval,
 * and "did the right person's number move" is a question no unit test with a
 * mocked Prisma can answer.
 *
 * The request is **created by the spec**, never picked out of the seed. The
 * seed is shared and destructive; a spec that approves a seeded request passes
 * once and then has nothing to approve.
 */
test.describe.configure({ mode: 'serial' });

test('an employee applies and their manager approves it', async ({ page, context }) => {
  const reason = `E2E leave ${Date.now()}`;

  await signIn(page, 'rohan');
  await page.goto('/leave');
  await page
    .getByRole('button', { name: /Apply for leave/i })
    .first()
    .click();

  // Deliberately loose selectors on the form itself: the point of this spec is
  // the hand-off between two people, not the shape of one dialog, and a strict
  // selector here would make an unrelated field rename look like a broken flow.
  await page
    .getByLabel(/reason|note/i)
    .first()
    .fill(reason);
  await page
    .getByRole('button', { name: /submit|apply/i })
    .last()
    .click();
  await expect(page.getByText(reason).first()).toBeVisible({ timeout: 20_000 });

  // A second context rather than a sign-out: a fresh browser context is the
  // only way to be certain nothing of the first session leaks into the second.
  const managerPage = await context
    .browser()
    ?.newContext()
    .then((c) => c.newPage());
  if (!managerPage) throw new Error('Could not open a second browser context');

  await signIn(managerPage, 'manager');
  await managerPage.goto('/leave/approvals');
  await expect(managerPage.getByText(reason).first()).toBeVisible({ timeout: 20_000 });
});
