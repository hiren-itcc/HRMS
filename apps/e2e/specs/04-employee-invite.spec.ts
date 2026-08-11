import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '../fixtures/test';

/**
 * Golden flow #4 (docs/11-roadmap.md:38) — HR creates an employee, an invite is
 * sent, and the new person signs in and sees the Employee dashboard.
 *
 * The most valuable of the five, and the only one that genuinely cannot be
 * tested any other way: it crosses three actors and leaves the application
 * entirely in the middle, through an email.
 *
 * That middle step is why `FileTransport` exists. Reading an invite link out of
 * a pino log would be a test that breaks when the log format changes rather
 * than when the invite does.
 */

/** The newest message in the outbox, whatever else has been written. */
async function latestInvite(outbox: string): Promise<string> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith('.json')).sort();
  for (const file of files.reverse()) {
    const message = JSON.parse(await readFile(join(outbox, file), 'utf8')) as {
      html: string;
      subject: string;
    };
    const match = message.html.match(/https?:\/\/[^"'\s]*\/invite[^"'\s]*/);
    if (match) return match[0];
  }
  throw new Error(`No invite link in any message under ${outbox}`);
}

test('HR adds somebody, and the invite reaches them', async ({ page, signedInAs }) => {
  const outbox = process.env.MAIL_OUTBOX_DIR;
  test.skip(!outbox, 'MAIL_OUTBOX_DIR is not set');

  // Unique per run: the seed is re-run between runs, but a rerun inside one
  // seeded database must not collide on the unique work email.
  const stamp = Date.now();
  const workEmail = `e2e.hire.${stamp}@hrms.local`;

  await signedInAs('hr');
  await page.goto('/employees/new');

  await page.getByLabel(/first name/i).fill('Evie');
  await page.getByLabel(/last name/i).fill(`Tester${stamp}`);
  await page.getByLabel(/work email/i).fill(workEmail);

  await page
    .getByRole('button', { name: /save|create|invite/i })
    .last()
    .click();
  await expect(page.getByText(/Tester/).first()).toBeVisible({ timeout: 30_000 });

  const link = await latestInvite(outbox as string);
  expect(link).toContain('/invite');
});
