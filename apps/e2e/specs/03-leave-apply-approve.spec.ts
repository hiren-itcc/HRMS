import { expect, PASSWORD, signIn, test, USERS } from '../fixtures/test';

/**
 * Golden flow #3 (docs/11-roadmap.md:46) — apply, then approve.
 *
 * The request is **created through the API and seen in the browser**, and the
 * split is deliberate. `apply-dialog.tsx` wants a leave type, two dates, a
 * duration and a reason; driving all five proves the dialog renders. What is
 * worth a browser is the other half — that a request one person made appears on
 * a different person's approvals screen — because that hand-off crosses two
 * sessions and two scopes, which no unit test with a mocked Prisma can see.
 *
 * Created by the spec rather than taken from the seed: the seed is shared, and
 * a spec that approves a seeded request passes once and then has nothing left
 * to approve.
 */
test.describe.configure({ mode: 'serial' });

const api = () => process.env.E2E_API_URL ?? 'http://localhost:4000';

test('a request one person makes reaches their manager’s approvals', async ({ page, request }) => {
  const reason = `E2E leave ${Date.now()}`;

  const signedIn = await request.post(`${api()}/api/v1/auth/login`, {
    data: { email: USERS.rohan, password: PASSWORD },
  });
  expect(signedIn.ok()).toBeTruthy();
  const { accessToken } = (await signedIn.json()) as { accessToken: string };
  const auth = { Authorization: `Bearer ${accessToken}` };

  /*
   * Whatever this organization actually calls its leave types. Hard-coding one
   * would break the day somebody renames it in the seed, which is a change that
   * should not fail a test about approvals.
   */
  const types = await request.get(`${api()}/api/v1/leave/types`, { headers: auth });
  expect(types.ok()).toBeTruthy();
  const payload = (await types.json()) as { id: string }[] | { data: { id: string }[] };
  const typeId = Array.isArray(payload) ? payload[0]?.id : payload.data?.[0]?.id;
  expect(typeId).toBeTruthy();

  const created = await request.post(`${api()}/api/v1/leave/requests`, {
    headers: auth,
    data: { leaveTypeId: typeId, startDate: '2026-11-16', endDate: '2026-11-17', reason },
  });
  expect(created.status(), await created.text()).toBeLessThan(300);

  // The half that needs a browser: a different person, a different screen.
  await signIn(page, 'manager');
  await page.goto('/leave/approvals');
  await expect(page.getByText(reason).first()).toBeVisible({ timeout: 20_000 });
});
