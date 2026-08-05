/**
 * The pay component catalogue every organization starts with.
 *
 * These codes are referenced by name from the calculation engine — `BASIC` is
 * the base for percentage lines and for PF, `PF`/`ESI`/`PT` are filled in by
 * the statutory engine rather than by a structure. They are seeded as
 * `isSystem`, which makes them undeletable; an organization may add its own
 * alongside them.
 */

export type PayComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';

export interface PayComponentSeed {
  code: string;
  name: string;
  kind: PayComponentKind;
  /** Counts toward taxable income. */
  taxable: boolean;
  /** Computed by the statutory engine, not by a structure line. */
  isStatutory: boolean;
}

/** Codes the engine looks up by name — renaming one is a breaking change. */
export const COMPONENT_CODES = {
  BASIC: 'BASIC',
  PF: 'PF',
  ESI: 'ESI',
  PROFESSIONAL_TAX: 'PT',
  TDS: 'TDS',
  EMPLOYER_PF: 'EMPLOYER_PF',
  EMPLOYER_ESI: 'EMPLOYER_ESI',
  LOP: 'LOP',
} as const;

export const DEFAULT_PAY_COMPONENTS: PayComponentSeed[] = [
  // ── Earnings ──
  { code: 'BASIC', name: 'Basic Salary', kind: 'EARNING', taxable: true, isStatutory: false },
  { code: 'HRA', name: 'House Rent Allowance', kind: 'EARNING', taxable: true, isStatutory: false },
  {
    code: 'SPECIAL',
    name: 'Special Allowance',
    kind: 'EARNING',
    taxable: true,
    isStatutory: false,
  },
  {
    code: 'CONVEYANCE',
    name: 'Conveyance Allowance',
    kind: 'EARNING',
    taxable: true,
    isStatutory: false,
  },
  {
    code: 'MEDICAL',
    name: 'Medical Allowance',
    kind: 'EARNING',
    taxable: true,
    isStatutory: false,
  },
  { code: 'BONUS', name: 'Bonus', kind: 'EARNING', taxable: true, isStatutory: false },
  { code: 'INCENTIVE', name: 'Incentives', kind: 'EARNING', taxable: true, isStatutory: false },
  { code: 'OVERTIME', name: 'Overtime', kind: 'EARNING', taxable: true, isStatutory: false },
  {
    code: 'REIMBURSEMENT',
    name: 'Reimbursements',
    kind: 'EARNING',
    // Reimbursing an expense is not income, so it never reaches taxable pay.
    taxable: false,
    isStatutory: false,
  },
  {
    code: 'OTHER_EARNING',
    name: 'Other Earnings',
    kind: 'EARNING',
    taxable: true,
    isStatutory: false,
  },

  // ── Exit only ──
  // Settlements carry their own figures rather than pushing lines into a
  // payroll run, so nothing computes these today. They exist so a settlement
  // line has a real component to map onto if that ever changes, and so the
  // component list a finance user reads is not missing the three things an
  // exit actually pays.
  {
    code: 'LEAVE_ENCASHMENT',
    name: 'Leave Encashment',
    kind: 'EARNING',
    taxable: true,
    isStatutory: false,
  },
  {
    code: 'GRATUITY',
    name: 'Gratuity',
    kind: 'EARNING',
    // Exempt under section 10(10) up to the statutory ceiling, which is the
    // ceiling the settlement settings default to.
    taxable: false,
    isStatutory: false,
  },

  // ── Deductions ──
  { code: 'PF', name: 'Provident Fund', kind: 'DEDUCTION', taxable: false, isStatutory: true },
  {
    code: 'ESI',
    name: 'Employee State Insurance',
    kind: 'DEDUCTION',
    taxable: false,
    isStatutory: true,
  },
  { code: 'PT', name: 'Professional Tax', kind: 'DEDUCTION', taxable: false, isStatutory: true },
  {
    code: 'TDS',
    name: 'Income Tax (TDS)',
    kind: 'DEDUCTION',
    taxable: false,
    // Entered per employee rather than projected — see the payroll settings.
    isStatutory: false,
  },
  {
    code: 'LOP',
    name: 'Loss of Pay',
    kind: 'DEDUCTION',
    taxable: false,
    isStatutory: false,
  },
  {
    code: 'ADVANCE_RECOVERY',
    name: 'Salary Advance Recovery',
    kind: 'DEDUCTION',
    taxable: false,
    isStatutory: false,
  },
  { code: 'LOAN', name: 'Loan Deduction', kind: 'DEDUCTION', taxable: false, isStatutory: false },
  {
    code: 'NOTICE_RECOVERY',
    name: 'Notice Period Recovery',
    kind: 'DEDUCTION',
    taxable: false,
    isStatutory: false,
  },
  {
    code: 'OTHER_DEDUCTION',
    name: 'Other Deductions',
    kind: 'DEDUCTION',
    taxable: false,
    isStatutory: false,
  },

  // ── Employer cost (shown on the payslip, never deducted from net) ──
  {
    code: 'EMPLOYER_PF',
    name: 'Employer PF',
    kind: 'EMPLOYER_CONTRIBUTION',
    taxable: false,
    isStatutory: true,
  },
  {
    code: 'EMPLOYER_ESI',
    name: 'Employer ESI',
    kind: 'EMPLOYER_CONTRIBUTION',
    taxable: false,
    isStatutory: true,
  },
];
