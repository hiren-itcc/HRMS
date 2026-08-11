import { expect, test } from '../fixtures/test';

/**
 * Golden flow #2 (docs/11-roadmap.md:42) — check in, then check out.
 *
 * **Serial, and it owns `asha` exclusively.** Attendance is one record per
 * employee per day, so "somebody who has not clocked in today" is a
 * once-per-seed resource. A second spec signing in as asha and clocking her in
 * makes this fail in a way that looks like infrastructure and is not — which is
 * why the seed banner calls her out as "unmarked today, clock in yourself" and
 * why this comment exists.
 */
test.describe.configure({ mode: 'serial' });

test.describe('attendance', () => {
  test('clocks in, then out, and the day reflects both', async ({ page, signedInAs }) => {
    await signedInAs('asha');
    await page.goto('/attendance');

    const clockIn = page.getByRole('button', { name: /check in/i });
    await expect(clockIn).toBeVisible();
    await clockIn.click();

    // Web-first assertion, never a fixed wait: the card re-renders when the
    // mutation settles, and a sleep here would be the flakiest line in the
    // suite.
    const clockOut = page.getByRole('button', { name: /check out/i });
    await expect(clockOut).toBeVisible({ timeout: 20_000 });

    await clockOut.click();
    await expect(page.getByText(/hours|worked/i).first()).toBeVisible({ timeout: 20_000 });
  });
});
