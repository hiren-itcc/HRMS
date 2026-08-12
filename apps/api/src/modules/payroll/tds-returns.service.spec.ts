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
    // somebody a file whose field order we guessed.
    const { prisma, settings } = makeDeps();
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
    // filed against numbers that then change is worse than no return.
    const { prisma, settings } = makeDeps();
    prisma.payrollRun.findMany.mockResolvedValue([
      { id: 'r1', month: '2026-07', status: 'PUBLISHED' },
      { id: 'r2', month: '2026-08', status: 'DRAFT' },
    ]);
    const service = new TdsReturnsService(prisma as never, settings as never);

    const result = await service.readiness(claims, '2026-27', 'Q2');

    expect(result.blocked).toMatch(/2026-08/);
    expect(result.blocked).toMatch(/published/i);
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
