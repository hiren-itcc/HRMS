import type {
  TaxDeclarationDecisionInput,
  TaxDeclarationInput,
  TaxDeclarationStatusCode,
  TaxRegimeCode,
  TaxSectionCode,
  TdsOverrideInput,
} from '@hrms/shared';
import { api } from '@/lib/api-client';
import { qs } from '@/lib/crud';

/**
 * Income tax.
 *
 * Every amount here is `number` because the API converts Prisma's `Decimal` at
 * its boundary. The engine behind it works in integer paise; by the time a
 * figure reaches this file it is rupees to two places and safe to format.
 *
 * `financialYear` and `month` are both explicit on every read. The month is
 * what fixes the remaining-months divisor — asking about April in December has
 * to still say twelve — so the client never lets the server guess "now".
 */

export interface SlabTax {
  fromAmount: number;
  toAmount: number | null;
  rate: number;
  taxableInBand: number;
  tax: number;
}

export interface AnnualTax {
  projectedAnnualIncome: number;
  exemptions: number;
  deductions: number;
  standardDeduction: number;
  projectedTaxableIncome: number;
  slabs: SlabTax[];
  incomeTax: number;
  rebate: number;
  surcharge: number;
  cess: number;
  annualTaxLiability: number;
}

export interface TaxSummary {
  financialYear: string;
  regime: TaxRegimeCode;
  month: string;
  declarationStatus: TaxDeclarationStatusCode | null;
  annual: AnnualTax;
  alreadyDeducted: number;
  remainingTax: number;
  remainingMonths: number;
  monthlyTds: number;
  override: { overrideTds: number; reason: string } | null;
  history: { month: string; tds: number }[];
}

export interface DeclarationItem {
  section: TaxSectionCode;
  declaredAmount: number;
  /** Null means the section has no ceiling. */
  statutoryLimit: number | null;
  /** Declared, capped by the limit. */
  eligibleAmount: number;
  /** What HR actually allowed — zero until they decide. */
  approvedAmount: number;
}

export interface Declaration {
  id: string;
  employeeId: string;
  financialYear: string;
  status: TaxDeclarationStatusCode;
  annualRentPaid: number | null;
  metroCity: boolean;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  revision: number;
  items: DeclarationItem[];
}

export interface PendingDeclaration extends Declaration {
  employee: { id: string; firstName: string; lastName: string; employeeCode: string };
}

export interface DeductionRule {
  section: TaxSectionCode;
  label: string;
  hint: string | null;
  maxAmount: number | null;
}

export interface TaxConfiguration {
  id: string;
  financialYear: string;
  regime: TaxRegimeCode;
  status: 'CONFIRMED' | 'UNCONFIRMED';
  source: string | null;
  standardDeduction: number;
  rebateIncomeLimit: number | null;
  rebateMaxAmount: number | null;
  cessRate: number;
  marginalRelief: boolean;
  slabs: { fromAmount: number; toAmount: number | null; rate: number }[];
  surchargeBands: { aboveIncome: number; rate: number }[];
  deductionRules: DeductionRule[];
}

export interface EmployeeTaxRow {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  department: string | null;
  financialYear: string;
  regime: TaxRegimeCode;
  declarationStatus: TaxDeclarationStatusCode | null;
  /** Null when the financial year has no confirmed configuration. */
  projectedTaxableIncome: number | null;
  annualTax: number | null;
  alreadyDeducted: number | null;
  remainingTax: number | null;
  monthlyTds: number | null;
  overridden: boolean;
}

export const taxKeys = {
  all: () => ['tax'] as const,
  me: (fy: string, month: string) => ['tax', 'me', fy, month] as const,
  myDeclaration: (fy: string) => ['tax', 'me', 'declaration', fy] as const,
  configuration: (fy?: string) => ['tax', 'configuration', fy ?? null] as const,
  employees: (fy: string, month: string, filters: Record<string, string | undefined>) =>
    ['tax', 'employees', fy, month, filters] as const,
  employee: (id: string, fy: string, month: string) => ['tax', 'employees', id, fy, month] as const,
  employeeDeclaration: (id: string, fy: string) =>
    ['tax', 'employees', id, 'declaration', fy] as const,
  pending: (fy: string) => ['tax', 'pending', fy] as const,
};

export const taxApi = {
  me: (financialYear: string, month: string) =>
    api<TaxSummary>(`/payroll/tax/me${qs({ financialYear, month })}`),
  setRegime: (financialYear: string, regime: TaxRegimeCode) =>
    api<{ financialYear: string; regime: TaxRegimeCode }>('/payroll/tax/me/regime', {
      method: 'PUT',
      body: JSON.stringify({ financialYear, regime }),
    }),
  myDeclaration: (financialYear: string) =>
    api<Declaration | null>(`/payroll/tax/me/declaration${qs({ financialYear })}`),
  saveDeclaration: (input: TaxDeclarationInput) =>
    api<Declaration>('/payroll/tax/me/declaration', { method: 'PUT', body: JSON.stringify(input) }),
  submitDeclaration: (financialYear: string) =>
    api<Declaration>('/payroll/tax/me/declaration/submit', {
      method: 'POST',
      body: JSON.stringify({ financialYear }),
    }),

  configuration: (financialYear?: string) =>
    api<TaxConfiguration[]>(`/payroll/tax/configuration${qs({ financialYear })}`),
  employees: (
    financialYear: string,
    month: string,
    filters: { regime?: string; status?: string; departmentId?: string; search?: string } = {},
  ) => api<EmployeeTaxRow[]>(`/payroll/tax/employees${qs({ financialYear, month, ...filters })}`),
  employee: (employeeId: string, financialYear: string, month: string) =>
    api<TaxSummary>(`/payroll/tax/employees/${employeeId}${qs({ financialYear, month })}`),
  employeeDeclaration: (employeeId: string, financialYear: string) =>
    api<Declaration | null>(
      `/payroll/tax/employees/${employeeId}/declaration${qs({ financialYear })}`,
    ),
  pending: (financialYear: string) =>
    api<PendingDeclaration[]>(`/payroll/tax/pending${qs({ financialYear })}`),
  approve: (employeeId: string, financialYear: string, input: TaxDeclarationDecisionInput) =>
    api<Declaration>(
      `/payroll/tax/employees/${employeeId}/declaration/approve${qs({ financialYear })}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  reject: (employeeId: string, financialYear: string, input: TaxDeclarationDecisionInput) =>
    api<Declaration>(
      `/payroll/tax/employees/${employeeId}/declaration/reject${qs({ financialYear })}`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  override: (employeeId: string, input: TdsOverrideInput) =>
    api<{ month: string; calculatedTds: number; overrideTds: number; reason: string }>(
      `/payroll/tax/employees/${employeeId}/override`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  clearOverride: (employeeId: string, month: string) =>
    api<{ id: string }>(`/payroll/tax/employees/${employeeId}/override${qs({ month })}`, {
      method: 'DELETE',
    }),
};

/** The financial year a month falls in — April starts it. Mirrors `tds-period.ts`. */
export function financialYearOf(month: string): string {
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const start = monthNumber >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** This month, as `yyyy-MM`. */
export function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}
