import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { as, createTestApp, login } from './app';

/**
 * The first test that runs payroll.
 *
 * `PayrollRunsService.calculate` and `TaxService.tdsForRun` shipped without
 * ever executing in a test process — not unit, not integration, not browser.
 * The engine had 84 tests, the guardrails 32, and the service that joins them
 * to payroll had four, every one of which asserted that it fails. The code
 * deciding how much tax comes out of somebody's pay had never once run.
 *
 * The load-bearing assertion is the cross-check in "the projection and the
 * payslip agree". Both figures come from `summarise`, so they must — and
 * nothing anywhere compares them. `tds-reconcile.ts` compares a different pair
 * (payslip against challan), and `summarise` returns the projection beside the
 * history in one object without ever looking at both.
 *
 * ## Which run this uses
 *
 * The seed leaves the **current month** as a DRAFT with no payslips —
 * `seed/payroll.ts` calls it "the current month sits open, so the workflow has
 * somewhere to start". That is exactly this. Creating a run instead is not an
 * option: `create()` refuses a month that already has one and refuses a future
 * month, and the seed owns the four months before this one.
 */

const HR = 'hr@hrms.local';

interface RunRow {
  id: string;
  month: string;
  status: string;
}

/**
 * A line as the API returns it, which is not how the database stores it:
 * `payslips.service.ts` renames `componentCode` to `code` and splits the rows
 * into `earnings` / `deductions` / `employerContributions` rather than
 * returning one `lines` array. TDS is written as a deduction —
 * `payroll.calc.ts:256`.
 */
interface PayslipLine {
  code: string;
  amount: number;
}

describe('payroll calculates tax', () => {
  let app: INestApplication;
  let hr: string;
  let run: RunRow;

  beforeAll(async () => {
    app = await createTestApp();
    hr = await login(app, HR);

    const runs = await request(app.getHttpServer())
      .get('/api/v1/payroll/runs?limit=50')
      .set(as(hr))
      .expect(200);

    // DRAFT or IN_REVIEW are the only states `calculate` is legal from, but
    // prefer DRAFT deliberately: the seed leaves *both* — the empty current
    // month and one historical month mid-review — and a bare `find` would pick
    // whichever the default sort happened to put first. This file's premise is
    // the current month, so say so rather than letting ordering decide.
    const rows = runs.body.data as RunRow[];
    const open =
      rows.find((row) => row.status === 'DRAFT') ?? rows.find((row) => row.status === 'IN_REVIEW');
    if (!open) throw new Error('The seed should leave an open run; none found.');
    run = open;
  });

  afterAll(async () => {
    await app?.close();
  });

  // 201, not 200: `actOnRun` is a plain `@Post` with no `@HttpCode`, so Nest's
  // default for POST applies. Asserting the status at all is the point — it is
  // part of the contract the web client already depends on.
  async function calculate() {
    return request(app.getHttpServer())
      .post(`/api/v1/payroll/runs/${run.id}/actions`)
      .set(as(hr))
      .send({ action: 'calculate' })
      .expect(201);
  }

  /**
   * Highest paid first. `netPay` is one of three sortable columns
   * (`payslips.service.ts:22`), and sorting by it puts the people the engine
   * actually taxes at the top — so the cross-check below finds a taxed
   * employee in its first few requests instead of walking the whole org to
   * reach one, which the 100-per-minute throttler would not forgive.
   */
  async function payslipsFor(runId: string) {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payroll/payslips?runId=${runId}&limit=100&sort=netPay&order=desc`)
      .set(as(hr))
      .expect(200);
    return res.body.data as { id: string; employeeId: string; employeeName: string }[];
  }

  async function deductionsOf(payslipId: string): Promise<PayslipLine[]> {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/payroll/payslips/${payslipId}`)
      .set(as(hr))
      .expect(200);
    const lines = res.body.deductions as PayslipLine[] | undefined;
    if (!lines) throw new Error('A payslip should carry a deductions array; it did not.');
    return lines;
  }

  const tdsOf = (lines: PayslipLine[]) =>
    Number(lines.find((line) => line.code === 'TDS')?.amount ?? 0);

  /**
   * How many payslips a comparison reads. The seed staffs the org with dozens
   * of people and the first version of this file fanned out over all of them
   * with `Promise.all` — dozens of concurrent supertest connections, which CI
   * answered with ECONNRESET. Sequential and bounded, then, which also keeps
   * the whole file inside the 100-per-minute global throttle
   * (`app.module.ts:55`); every assertion below says out loud that it looked at
   * a sample rather than the whole run.
   */
  const SAMPLE = 8;

  /**
   * TDS keyed by employee, read one request at a time.
   *
   * Keyed rather than a list: comparing sorted arrays would call two runs equal
   * when the same set of figures landed on different people, which is exactly
   * the bug a recalculation could introduce.
   */
  async function tdsByEmployee(slips: { id: string; employeeId: string }[]) {
    const figures = new Map<string, number>();
    for (const slip of slips.slice(0, SAMPLE)) {
      figures.set(slip.employeeId, tdsOf(await deductionsOf(slip.id)));
    }
    return figures;
  }

  it('produces payslips at all', async () => {
    const res = await calculate();
    expect(res.body.status).toBe('IN_REVIEW');

    const slips = await payslipsFor(run.id);
    expect(slips.length).toBeGreaterThan(0);
  });

  /**
   * The reason this file exists.
   *
   * The payslip's TDS line and `GET /payroll/tax/employees/:id`'s `monthlyTds`
   * are produced by the same function for the same employee and month, so they
   * must agree. If a refactor ever separates them, this is the only thing in
   * the repo that would notice.
   */
  it('deducts exactly what the projection says it will', async () => {
    await calculate();
    const slips = await payslipsFor(run.id);

    // Somebody the engine actually taxed — an employee under the threshold
    // proves nothing, since 0 === 0 for the wrong reasons. The list arrives
    // highest-paid first, so the top SAMPLE is where the taxed people are; the
    // scan stops there rather than running the org's full headcount past a
    // throttler.
    let checked = 0;
    for (const slip of slips.slice(0, SAMPLE)) {
      const deducted = tdsOf(await deductionsOf(slip.id));
      if (deducted <= 0) continue;

      const projection = await request(app.getHttpServer())
        .get(`/api/v1/payroll/tax/employees/${slip.employeeId}?month=${run.month}`)
        .set(as(hr))
        .expect(200);

      expect({ who: slip.employeeName, tds: deducted }).toEqual({
        who: slip.employeeName,
        tds: projection.body.monthlyTds,
      });
      checked += 1;
      if (checked === 3) break;
    }

    // A vacuous pass is not a pass. If nobody was taxed the assertion above
    // never ran, and this test would be green while proving nothing. The seed
    // pays several people well over the threshold, so zero here means the
    // engine stopped deducting — not that the sample was unlucky.
    expect(checked).toBeGreaterThan(0);
  });

  /**
   * `calculate` is destructive by design — it deletes every payslip for the run
   * and rebuilds. Running it twice must land in the same place, not double the
   * lines or drift the figures.
   */
  it('is idempotent', async () => {
    await calculate();
    const firstSlips = await payslipsFor(run.id);
    const before = await tdsByEmployee(firstSlips);

    await calculate();
    const secondSlips = await payslipsFor(run.id);
    const after = await tdsByEmployee(secondSlips);

    // The count is checked across the whole run — a rebuild that dropped or
    // duplicated people would show up here. The figures are checked across the
    // first SAMPLE of it.
    expect(secondSlips.length).toBe(firstSlips.length);
    expect(Object.fromEntries(after)).toEqual(Object.fromEntries(before));

    // One TDS line per payslip, not one per recalculation.
    const lines = await deductionsOf(secondSlips[0]?.id as string);
    expect(lines.filter((line) => line.code === 'TDS').length).toBeLessThanOrEqual(1);
  });

  /**
   * The invariant the whole module rests on, asserted nowhere until now.
   *
   * A recalculation changes what the *open* run deducts. Published payslips are
   * frozen — `payroll.workflow.ts` only permits `calculate` from DRAFT or
   * IN_REVIEW — and `alreadyDeducted` is read from them, so the divisor
   * self-corrects rather than history being rewritten.
   */
  it('never touches a published payslip', async () => {
    const runs = await request(app.getHttpServer())
      .get('/api/v1/payroll/runs?limit=50')
      .set(as(hr))
      .expect(200);
    const published = (runs.body.data as RunRow[]).find((row) => row.status === 'PUBLISHED');
    if (!published) throw new Error('The seed should leave a published run; none found.');

    const before = await payslipsFor(published.id);
    const beforeTds = await tdsByEmployee(before);

    await calculate();

    const after = await payslipsFor(published.id);
    const afterTds = await tdsByEmployee(after);

    // Identity across the whole published run, figures across the first SAMPLE.
    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
    expect(Object.fromEntries(afterTds)).toEqual(Object.fromEntries(beforeTds));

    // And it refuses outright if somebody tries.
    await request(app.getHttpServer())
      .post(`/api/v1/payroll/runs/${published.id}/actions`)
      .set(as(hr))
      .send({ action: 'calculate' })
      .expect(400);
  });

  /**
   * An employee whose financial year has no confirmed rules is skipped rather
   * than deducted zero — a zero on a payslip reads as "no tax due", which is a
   * different claim from "nobody has entered this year's slabs". The count is
   * the only surviving record of it.
   */
  it('reports how many employees had no confirmed tax rules', async () => {
    const res = await calculate();
    expect(res.body).toHaveProperty('taxUnconfigured');
    expect(typeof res.body.taxUnconfigured).toBe('number');
  });
});
