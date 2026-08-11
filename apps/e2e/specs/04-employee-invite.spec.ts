import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, PASSWORD, test, USERS } from '../fixtures/test';

/**
 * Golden flow #4 (docs/11-roadmap.md:38) — HR adds somebody, an invite is sent,
 * and the link in it opens.
 *
 * **`/employees/onboard`, not `/employees`.** The first version of this spec
 * used the latter with `createLogin: true`, which creates an **ACTIVE** account
 * on the shared default password and emails nobody — doc 07 calls that "for
 * staff who already work here". Nothing was wrong with the assertion; it was
 * waiting for an invite that was never going to be sent, and the outbox was
 * empty because there was nothing to put in it. `OnboardingService.onboard` is
 * the path that mints an invitation and mails it.
 *
 * Created through the API rather than the form, deliberately:
 * `employee-form.tsx` has twelve selects and five required references, and
 * driving them proves the form renders. The value of this flow is the hand-off
 * — HR acts, the application is left entirely, an email arrives, somebody comes
 * back through the link — and only the last step of that needs a browser.
 *
 * `FileTransport` is what makes the middle step assertable. Reading a link out
 * of a pino log would be a test that breaks when the log format changes rather
 * than when the invite does.
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

test('HR onboards somebody, and the invite link opens', async ({ page, request }) => {
  const outbox = process.env.MAIL_OUTBOX_DIR;
  test.skip(!outbox, 'MAIL_OUTBOX_DIR is not set');

  const api = process.env.E2E_API_URL ?? 'http://localhost:4000';
  const stamp = Date.now();

  const signedIn = await request.post(`${api}/api/v1/auth/login`, {
    data: { email: USERS.hr, password: PASSWORD },
  });
  expect(signedIn.ok()).toBeTruthy();
  const { accessToken } = (await signedIn.json()) as { accessToken: string };

  /*
   * Every organisational reference is optional on this route — unlike
   * `POST /employees`, which requires five — so a new hire can be recorded
   * before anybody has decided where they sit.
   */
  const created = await request.post(`${api}/api/v1/employees/onboard`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      firstName: 'Evie',
      lastName: `Tester${stamp}`,
      workEmail: `e2e.hire.${stamp}@hrms.local`,
      // Where the invite actually goes. Required here, and required for a
      // reason: a work address does not exist yet for somebody who has not
      // started, and a formulaic one may reach a catch-all somebody else reads.
      personalEmail: `e2e.personal.${stamp}@example.test`,
      joinDate: '2026-09-01',
    },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);

  // The step that left the application entirely.
  const link = await latestInvite(outbox as string);
  expect(link).toContain('/invite');

  /*
   * And back in through the browser. `/invite` is exempt from the signed-in
   * bounce in `proxy.ts`, so this renders whether or not a session exists —
   * which is the behaviour that file's comment says it exists for.
   */
  await page.goto(link);
  await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
});
