import { expect, signIn, test } from '../fixtures/test';

/**
 * Golden flow #5 (docs/11-roadmap.md:49) — publish, and somebody else reads it.
 *
 * Two actors and an audience rule between them, which is the part worth
 * checking in a browser: "did the right people see it" is a question about a
 * query and a screen together.
 */
test.describe.configure({ mode: 'serial' });

test('an announcement reaches an employee who did not write it', async ({ page, context }) => {
  const title = `E2E announcement ${Date.now()}`;

  await signIn(page, 'hr');
  await page.goto('/announcements');
  await page
    .getByRole('button', { name: /New announcement/i })
    .first()
    .click();

  await page.getByLabel(/^Title/).fill(title);
  await page
    .getByLabel(/^Message/)
    .first()
    .fill('Posted by the end-to-end suite.');
  await page
    .getByRole('button', { name: /^Publish$/ })
    .last()
    .click();

  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 });

  const readerPage = await context
    .browser()
    ?.newContext()
    .then((c) => c.newPage());
  if (!readerPage) throw new Error('Could not open a second browser context');

  await signIn(readerPage, 'rohan');
  await readerPage.goto('/announcements');
  await expect(readerPage.getByText(title).first()).toBeVisible({ timeout: 20_000 });
});
