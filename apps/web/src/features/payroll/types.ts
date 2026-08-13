export type RunStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'LOCKED' | 'PUBLISHED' | 'CANCELLED';
export type PaymentStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED' | 'CANCELLED';
export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'EMPLOYER_CONTRIBUTION';
export type CalcType = 'FLAT' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_CTC' | 'STATUTORY' | 'BALANCE';

export interface PayComponent {
  id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  taxable: boolean;
  isStatutory: boolean;
  isSystem: boolean;
  /** Sorts the catalogue only — not payslip line order. See the field's hint on the editor. */
  order: number;
  active: boolean;
}

export interface StructureLine {
  id: string;
  componentId: string;
  componentCode: string;
  componentName: string;
  kind: ComponentKind;
  isStatutory: boolean;
  calcType: CalcType;
  value: number;
  order: number;
}

export interface SalaryStructure {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  assignedCount: number;
  lines: StructureLine[];
}

export interface SalaryRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  department: string | null;
  designation: string | null;
  status: string;
  joinDate: string | null;
  current: {
    id: string;
    structureId: string;
    structureName: string;
    monthlyCtc: number;
    monthlyTds: number;
    effectiveFrom: string | null;
    revisionType: string;
    paymentMethod: string;
  } | null;
}

export interface SalaryRevision {
  id: string;
  effectiveFrom: string | null;
  structureId: string;
  structureName: string;
  monthlyCtc: number;
  monthlyTds: number;
  revisionType: string;
  reason: string | null;
  paymentMethod: string;
  createdAt: string;
  previousCtc: number | null;
  changeAmount: number | null;
  changePercent: number | null;
}

export interface SalaryTimeline {
  employee: {
    id: string;
    employeeCode: string;
    name: string;
    department: string | null;
    designation: string | null;
    joinDate: string | null;
    exitDate: string | null;
    status: string;
    bank: { bankName: string; accountNumberMasked: string | null; ifsc: string | null } | null;
  };
  current: SalaryRevision | null;
  revisions: SalaryRevision[];
}

export interface PayrollRun {
  id: string;
  month: string;
  status: RunStatus;
  payDate: string | null;
  notes: string | null;
  employeeCount: number;
  totalEarnings: number;
  totalDeductions: number;
  totalEmployerCost: number;
  netPayable: number;
  calculatedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  /**
   * How many employees the run could not tax, because their financial year has
   * no confirmed rules. Present only on the response to `calculate` — it
   * describes what that calculation did, not a stored property of the run.
   */
  taxUnconfigured?: number;
}

export interface Preflight {
  month: string;
  eligible: number;
  totalConsidered: number;
  blocking: {
    noSalary: { id: string; name: string }[];
    emptyStructure: { id: string; name: string }[];
  };
  warnings: { noBank: { id: string; name: string }[] };
  canCalculate: boolean;
}

export interface PayslipRow {
  id: string;
  runId: string;
  month: string;
  runStatus: RunStatus;
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  department: string | null;
  designation: string | null;
  payableDays: number;
  lopDays: number;
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  carriedShortfall: number;
  paymentStatus: PaymentStatus;
  paymentMethod: string;
  paidAt: string | null;
  payDate: string | null;
}

export interface PayslipLine {
  code: string;
  name: string;
  kind: ComponentKind;
  amount: number;
}

export interface Payslip {
  id: string;
  runId: string;
  month: string;
  runStatus: RunStatus;
  payDate: string | null;
  employee: {
    id: string;
    code: string;
    name: string;
    department: string | null;
    designation: string | null;
  };
  structureName: string;
  bank: { name: string | null; accountNumberMasked: string | null; ifsc: string | null };
  days: { working: number; lop: number; payable: number };
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  employerContributions: PayslipLine[];
  totals: {
    gross: number;
    deductions: number;
    employerContribution: number;
    net: number;
    carriedShortfall: number;
  };
  payment: {
    status: PaymentStatus;
    method: string;
    paidAt: string | null;
    reference: string | null;
    failureReason: string | null;
  };
}

export interface PayrollReport {
  title: string;
  month: string;
  columns: { key: string; header: string; type?: 'text' | 'number' | 'date' }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, number>;
}
