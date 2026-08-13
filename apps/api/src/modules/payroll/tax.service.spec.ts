import { UnprocessableEntityException } from '@nestjs/common';
import { TaxService } from './tax.service';

/**
 * The HTTP boundary the engine's spec cannot see.
 *
 * `tax.engine.spec.ts` asserts that an unconfirmed financial year throws
 * `TaxConfigurationMissing`, and it does. What no unit test covered was what
 * that becomes over HTTP — and the answer, on the first deployment, was a
 * **500**, because a plain `Error` is exactly what Nest's filter reads as an
 * internal fault. The screen degraded correctly and the logs said the server
 * had broken.
 *
 * It had not. An unconfirmed year is a well-formed request against a piece of
 * configuration nobody has entered yet. This pins the distinction.
 */

function makeService(config: unknown) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    taxConfiguration: { findUnique: jest.fn().mockResolvedValue(config) },
    employeeTaxProfile: { findUnique: jest.fn().mockResolvedValue(null) },
    employee: { findMany: jest.fn().mockResolvedValue([]) },
    employeeSalary: { findMany: jest.fn().mockResolvedValue([]) },
    payslip: { findMany: jest.fn().mockResolvedValue([]) },
    employeeTaxDeclaration: { findMany: jest.fn().mockResolvedValue([]) },
    tdsOverride: { findMany: jest.fn().mockResolvedValue([]) },
    payComponent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const settings = { get: jest.fn().mockResolvedValue({ payroll: {} }) };
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  return new TaxService(prisma, settings as any);
}

const UNCONFIRMED_ROW = {
  status: 'UNCONFIRMED',
  standardDeduction: 0,
  rebateIncomeLimit: null,
  rebateMaxAmount: null,
  cessRate: 0,
  marginalRelief: true,
  slabs: [],
  surchargeBands: [],
  deductionRules: [],
};

describe('an unconfirmed financial year', () => {
  /* The row does not exist at all. */
  it('is 422, not 500, when the year was never created', async () => {
    const service = makeService(null);
    await expect(service.summaryFor('org1', 'e1', '2026-27', '2026-08')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  /*
   * The row exists but carries no slabs — the shape the seed ships. This is the
   * one that actually fired in production, and it throws from a different place
   * (`calculateAnnualTax`, not `configFor`), which is why the whole read is
   * wrapped rather than just the lookup.
   */
  it('is 422 when the year exists but nobody has confirmed it', async () => {
    const service = makeService(UNCONFIRMED_ROW);
    await expect(service.summaryFor('org1', 'e1', '2026-27', '2026-08')).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('says which year, and that somebody has to enter it', async () => {
    const service = makeService(null);
    await expect(service.summaryFor('org1', 'e1', '2026-27', '2026-08')).rejects.toThrow(/2026-27/);
  });

  /*
   * The distinction the mapping exists to preserve: a genuine fault must still
   * reach the caller as a fault, not be flattened into 422 along with it.
   */
  it('leaves a real failure alone', async () => {
    const service = makeService(null);
    // biome-ignore lint/suspicious/noExplicitAny: reaching into the double
    (service as any).prisma.taxConfiguration.findUnique.mockRejectedValue(
      new Error('connection reset'),
    );
    await expect(service.summaryFor('org1', 'e1', '2026-27', '2026-08')).rejects.toThrow(
      'connection reset',
    );
    await expect(service.summaryFor('org1', 'e1', '2026-27', '2026-08')).rejects.not.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
