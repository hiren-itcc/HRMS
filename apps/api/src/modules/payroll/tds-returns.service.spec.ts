import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TdsReturnsService } from './tds-returns.service';

const claims = { orgId: 'org-1', sub: 'user-1' } as never;

const STATUTORY = {
  tan: 'AHMH12345A',
  pan: 'AAACA1234A',
  signatoryName: 'Priya Sharma',
  signatoryDesignation: 'Director',
  pfEstablishmentCode: '',
  esiEmployerCode: '',
};

function makeDeps(overrides: Record<string, unknown> = {}) {
  const prisma = {
    payrollRun: { findMany: jest.fn().mockResolvedValue([]) },
    payslip: { findMany: jest.fn().mockResolvedValue([]) },
    tdsChallan: { findMany: jest.fn().mockResolvedValue([]) },
    tdsReturn: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme Industries' }) },
    auditLog: { create: jest.fn() },
    ...overrides,
  };
  const settings = { get: jest.fn().mockResolvedValue({ statutory: STATUTORY }) };
  return { prisma, settings };
}

describe('TdsReturnsService readiness', () => {
  it('refuses while the record layout is untranscribed', async () => {
    // Task 13 lifts this. Until then the screen must say so rather than hand
    // somebody a file whose field order we guessed. Needs three published
    // runs so the layout check is what's exercised, not the "quarter is
    // incomplete" refusal this test isn't about.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.layoutBlocked).toMatch(/layout has not been transcribed/i);
    // And it must NOT masquerade as a data problem — the substantive checks
    // still ran and found nothing wrong with this quarter's settings.
    expect(result.blocked).toBeNull();
  });

  it('refuses without a TAN, and names where to set it', async () => {
    const { prisma, settings } = makeDeps();
    settings.get.mockResolvedValue({ statutory: { ...STATUTORY, tan: '' } });
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/TAN/i);
    expect(result.blocked).toMatch(/Settings/i);
  });

  it('refuses without a named responsible person', async () => {
    // statutorySchema calls this signatoryName, not signatory. The 24Q header
    // names whoever is answerable for the return.
    const { prisma, settings } = makeDeps();
    settings.get.mockResolvedValue({ statutory: { ...STATUTORY, signatoryName: '' } });
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/responsible person/i);
  });

  it('refuses when a month in the quarter has no published run', async () => {
    // The rule statutory-filings.service.ts already enforces monthly: a return
    // filed against numbers that then change is worse than no return. 2026-09
    // is absent from the mock entirely, so under the corrected logic this also
    // reports a missing run alongside the unpublished one.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue([
      { id: 'r1', month: '2026-07', status: 'PUBLISHED' },
      { id: 'r2', month: '2026-08', status: 'DRAFT' },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/2026-08/);
    expect(result.blocked).toMatch(/unpublished/i);
    expect(result.blocked).toMatch(/2026-09/);
    expect(result.blocked).toMatch(/no payroll run/i);
  });

  it('refuses a quarter with a month that was never run at all', async () => {
    // Not the same as "not published": there is no run to publish. A 24Q
    // covering Jul-Sep that silently omits September is a short return, and
    // the department has no way to know a month is missing.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue([
      { id: 'r0', month: '2026-07', status: 'PUBLISHED' },
      { id: 'r1', month: '2026-08', status: 'PUBLISHED' },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/2026-09/);
    expect(result.blocked).toMatch(/no payroll run/i);
  });

  it('refuses when a month deducted TDS and has no challan', async () => {
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    prisma.payslip.findMany.mockResolvedValue([
      {
        runId: 'r0',
        employeeCode: 'EMP-1',
        employeeName: 'A',
        grossEarnings: '50000',
        lines: [{ componentCode: 'TDS', amount: '500' }],
        employee: { pan: 'ABCPD1234E' },
      },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/no challan/i);
  });

  it('refuses on a challan that disagrees with the payslips, and states the difference', async () => {
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    prisma.payslip.findMany.mockResolvedValue([
      {
        runId: 'r0',
        employeeCode: 'EMP-1',
        employeeName: 'A',
        grossEarnings: '50000',
        lines: [{ componentCode: 'TDS', amount: '500' }],
        employee: { pan: 'ABCPD1234E' },
      },
    ]);
    prisma.tdsChallan.findMany.mockResolvedValue([
      {
        period: '2026-07',
        bsrCode: '0510308',
        challanSerial: '1',
        depositDate: new Date('2026-08-07'),
        tds: '400',
        surcharge: '0',
        educationCess: '0',
        interest: '0',
        fee: '0',
        penalty: '0',
        others: '0',
      },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/100/);
  });

  it('refuses when a month has two runs and one of them is not PUBLISHED', async () => {
    // new Map(runs.map(...)) keeps whichever row the query returned last, so
    // a month holding both a DRAFT and a PUBLISHED run could arbitrarily read
    // as published. A month must count as published only if every run for it
    // is PUBLISHED.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue([
      { id: 'r0', month: '2026-07', status: 'DRAFT' },
      { id: 'r0b', month: '2026-07', status: 'PUBLISHED' },
      { id: 'r1', month: '2026-08', status: 'PUBLISHED' },
      { id: 'r2', month: '2026-09', status: 'PUBLISHED' },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/2026-07/);
    expect(result.blocked).toMatch(/unpublished/i);
  });

  it('warns about a missing PAN without blocking', async () => {
    // A 24Q can legitimately be filed for a deductee whose PAN is unavailable.
    // Refusing would stop the company meeting a statutory deadline over a data
    // quality problem, which is the harm the gate exists to prevent.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    prisma.payslip.findMany.mockResolvedValue([
      {
        runId: 'r0',
        employeeCode: 'EMP-1',
        employeeName: 'A',
        grossEarnings: '50000',
        lines: [{ componentCode: 'TDS', amount: '500' }],
        employee: { pan: null },
      },
    ]);
    prisma.tdsChallan.findMany.mockResolvedValue([
      {
        period: '2026-07',
        bsrCode: '0510308',
        challanSerial: '1',
        depositDate: new Date('2026-08-07'),
        tds: '500',
        surcharge: '0',
        educationCess: '0',
        interest: '0',
        fee: '0',
        penalty: '0',
        others: '0',
      },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/PAN/i);
  });

  it('warns that a Q4 return still needs Annexure II', async () => {
    // Q4 additionally requires Annexure II, the annual salary annexure, which
    // this feature does not produce. The warning has to land in the stored
    // row, not only on screen, or an operator downloading the frozen file a
    // week later sees no reminder anywhere near it.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2027-01', '2027-02', '2027-03'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q4');

    expect(result.blocked).toBeNull();
    expect(result.warnings.join(' ')).toMatch(/Annexure II/i);
  });

  it('does not warn about Annexure II for a quarter other than Q4', async () => {
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toBeNull();
    expect(result.warnings.join(' ')).not.toMatch(/Annexure/i);
  });
});

describe('TdsReturnsService generate', () => {
  it('refuses a second return for a quarter already generated', async () => {
    const { prisma, settings } = makeDeps();
    prisma.tdsReturn.findFirst.mockResolvedValue({ id: 'existing', generatedAt: new Date() });
    const service = new TdsReturnsService(prisma as never, settings as never);

    await expect(service.generate(claims, '2026-27', 'Q2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.tdsReturn.create).not.toHaveBeenCalled();
  });

  it('refuses when readiness is blocked, and writes nothing', async () => {
    const { prisma, settings } = makeDeps();
    settings.get.mockResolvedValue({ statutory: { ...STATUTORY, tan: '' } });
    const service = new TdsReturnsService(prisma as never, settings as never);

    await expect(service.generate(claims, '2026-27', 'Q2')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.tdsReturn.create).not.toHaveBeenCalled();
  });

  it('never reports a duplicate as "generated on null"', async () => {
    // toDateKey returns string | null. A row with no generatedAt must not
    // produce a message that literally reads "was already generated on null".
    const { prisma, settings } = makeDeps();
    prisma.tdsReturn.findFirst.mockResolvedValue({ id: 'existing', generatedAt: null });
    const service = new TdsReturnsService(prisma as never, settings as never);

    await expect(service.generate(claims, '2026-27', 'Q2')).rejects.toMatchObject({
      message: expect.not.stringContaining('null'),
    });
  });

  it('gathers payroll data exactly once, even though readiness passes and a file gets built', async () => {
    // Task 13's LAYOUT_TRANSCRIBED flip is what makes generate() actually
    // reach built() today, so it is mocked true just for this test — this is
    // the finding: readiness() and built() each used to call gather() and
    // settings.get() for themselves, so a run could be unpublished between
    // the two reads and the written file would disagree with the readiness
    // that approved it.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue(
      ['2026-07', '2026-08', '2026-09'].map((month, i) => ({
        id: `r${i}`,
        month,
        status: 'PUBLISHED',
      })),
    );
    prisma.payslip.findMany.mockResolvedValue([
      {
        runId: 'r0',
        employeeCode: 'EMP-1',
        employeeName: 'A',
        grossEarnings: '50000',
        lines: [{ componentCode: 'TDS', amount: '500' }],
        employee: { pan: 'ABCPD1234E' },
      },
    ]);
    prisma.tdsChallan.findMany.mockResolvedValue([
      {
        period: '2026-07',
        bsrCode: '0510308',
        challanSerial: '1',
        depositDate: new Date('2026-08-07'),
        tds: '500',
        surcharge: '0',
        educationCess: '0',
        interest: '0',
        fee: '0',
        penalty: '0',
        others: '0',
      },
    ]);
    prisma.tdsReturn.create.mockResolvedValue({ id: 'new-return' });

    let service!: InstanceType<typeof TdsReturnsService>;
    jest.isolateModules(() => {
      jest.doMock('./tds-files', () => ({
        ...jest.requireActual('./tds-files'),
        LAYOUT_TRANSCRIBED: true,
      }));
      // biome-ignore lint/suspicious/noExplicitAny: fresh isolated-registry import, untyped by construction
      const Isolated = require('./tds-returns.service').TdsReturnsService as any;
      service = new Isolated(prisma, settings);
    });

    await service.generate(claims, '2026-27', 'Q2');

    expect(prisma.payrollRun.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.payslip.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.tdsChallan.findMany).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(prisma.tdsReturn.create).toHaveBeenCalledTimes(1);
  });
});

describe('TdsReturnsService file', () => {
  it('serves the frozen bytes and never rebuilds', async () => {
    const { prisma, settings } = makeDeps();
    prisma.tdsReturn.findFirst.mockResolvedValue({
      id: 't1',
      financialYear: '2026-27',
      quarter: 'Q2',
      content: 'FROZEN',
    });
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.file(claims, 't1');

    expect(result.content).toBe('FROZEN');
    expect(result.filename).toBe('form24q-2026-27-Q2.txt');
  });

  it('404s a return belonging to another organization', async () => {
    const { prisma, settings } = makeDeps();
    prisma.tdsReturn.findFirst.mockResolvedValue(null);
    const service = new TdsReturnsService(prisma as never, settings as never);

    await expect(service.file(claims, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
