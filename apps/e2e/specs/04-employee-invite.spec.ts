import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, PASSWORD, test, USERS } from '../fixtures/test';

/**
 * Golden flow #4 (docs/11-roadmap.md:38) — HR adds somebody, an invite is sent,
 * and the link in it opens.
 *
 * **The employee is created through the API, deliberately.** The first version
 * of this spec filled the form and could never have worked: `employee-form.tsx`
 * has twelve selects and five required references, and driving all of them
 * proves the form renders rather than proving anything about the invite. The
 * value of this flow is the hand-off — HR acts, the application is left
 * entirely, an email arrives, and somebody else comes back through the link —
 * and only the last step of that needs a browser.
 *
 * `FileTransport` is what makes the middle step assertable at all. Reading a
 * link out of a pino log would be a test that breaks when the log format
 * changes rather than when the invite does.
 */

/** The newest message in the outbox that carries an invite link. */
async function latestInvite(outbox: string): Promise<string> {
  const files = (await readdir(outbox)).filter((f) => f.endsWith('.json')).sort();
  for (const file of files.reverse()) {
    const message = JSON.parse(await readFile(join(outbox, file), 'utf8')) as { html: string };
    const match = message.html.match(/https?:\/\/[^"'\s]*\/invite[^"'\s]*/);
    if (match) return match[0];
  }
  throw new Error(`No invite link in any message under ${outbox}`);
}

test('HR adds somebody, and the invite link opens', async ({ page, request }) => {
  const outbox = process.env.MAIL_OUTBOX_DIR;
  test.skip(!outbox, 'MAIL_OUTBOX_DIR is not set');

  const api = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const stamp = Date.now();

  const signIn = await request.post(`${api}/api/v1/auth/login`, {
    data: { email: USERS.hr, password: PASSWORD },
  });
  expect(signIn.ok()).toBeTruthy();
  const { accessToken } = (await signIn.json()) as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };

  /*
   * Borrow the references from somebody who already exists rather than
   * hard-coding ids the seed is free to change. Five required foreign keys is
   * the reason this spec does not drive the form.
   */
  const listed = await request.get(`${api}/api/v1/employees?limit=1`, { headers: auth });
  expect(listed.ok()).toBeTruthy();
  const existing = ((await listed.json()) as { data: Record<string, string>[] }).data[0];
  expect(existing).toBeTruthy();

  const created = await request.post(`${api}/api/v1/employees`, {
    headers: auth,
    data: {
      firstName: 'Evie',
      lastName: `Tester${stamp}`,
      workEmail: `e2e.hire.${stamp}@hrms.local`,
      // Where the invite actually goes — a work address does not exist yet for
      // somebody who has not started.
      personalEmail: `e2e.personal.${stamp}@example.test`,
      joinDate: '2026-09-01',
      departmentId: existing?.departmentId,
      designationId: existing?.designationId,
      locationId: existing?.locationId,
      shiftId: existing?.shiftId,
      employmentTypeId: existing?.employmentTypeId,
      createLogin: true,
    },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);

  // The step that left the application entirely.
  const link = await latestInvite(outbox as string);
  expect(link).toContain('/invite');

  /*
   * And back in through the browser. `/invite` is exempt from the signed-in
   * bounce in `proxy.ts`, so this renders whether or not a session exists —
   * which is the behaviour that comment says it exists for.
   */
  await page.goto(link);
  await expect(page.getByRole('heading')).toBeVisible({ timeout: 20_000 });
});
