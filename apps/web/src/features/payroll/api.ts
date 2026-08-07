import type {
  EmployeeSalaryInput,
  PaymentUpdateInput,
  PayrollAdjustmentInput,
  PayrollRunActionInput,
  PayrollRunCreateInput,
  SalaryStructureCreateInput,
  SalaryStructureUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import type {
  PayComponent,
  PayrollReport,
  PayrollRun,
  Payslip,
  PayslipRow,
  Preflight,
  SalaryRow,
  SalaryStructure,
  SalaryTimeline,
} from './types';

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
};

export const payrollApi = {
  components: () => api<PayComponent[]>('/payroll/components'),

  /** One-off amounts for a month: bonuses, incentives, loan instalments. */
  adjustments: (month: string, employeeId?: string) =>
    api<PayrollAdjustment[]>(`/payroll/adjustments${qs({ month, employeeId })}`),
  setAdjustment: (input: PayrollAdjustmentInput) =>
    api<{ id: string }>('/payroll/adjustments', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteAdjustment: (id: string) =>
    api<{ id: string }>(`/payroll/adjustments/${id}`, { method: 'DELETE' }),

  structures: (params: Record<string, string | number | undefined> = {}) =>
    api<Paginated<SalaryStructure>>(`/payroll/structures${qs(params)}`),
  structureOptions: () => api<SalaryStructure[]>('/payroll/structures/options'),
  structure: (id: string) => api<SalaryStructure>(`/payroll/structures/${id}`),
  createStructure: (body: SalaryStructureCreateInput) =>
    api<SalaryStructure>('/payroll/structures', { method: 'POST', body: JSON.stringify(body) }),
  updateStructure: (id: string, body: SalaryStructureUpdateInput) =>
    api<SalaryStructure>(`/payroll/structures/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  cloneStructure: (id: string) =>
    api<SalaryStructure>(`/payroll/structures/${id}/clone`, { method: 'POST' }),
  deleteStructure: (id: string) =>
    api<{ id: string }>(`/payroll/structures/${id}`, { method: 'DELETE' }),

  salaries: (params: Record<string, string | number | undefined> = {}) =>
    api<Paginated<SalaryRow>>(`/payroll/salaries${qs(params)}`),
  mySalary: () => api<SalaryTimeline>('/payroll/salaries/me'),
  salaryTimeline: (employeeId: string) => api<SalaryTimeline>(`/payroll/salaries/${employeeId}`),
  assignSalary: (body: EmployeeSalaryInput) =>
    api<{ id: string }>('/payroll/salaries', { method: 'POST', body: JSON.stringify(body) }),
  deleteSalary: (id: string) =>
    api<{ id: string }>(`/payroll/salaries/${id}`, { method: 'DELETE' }),

  runs: (params: Record<string, string | number | undefined> = {}) =>
    api<Paginated<PayrollRun>>(`/payroll/runs${qs(params)}`),
  run: (id: string) => api<PayrollRun>(`/payroll/runs/${id}`),
  preflight: (id: string) => api<Preflight>(`/payroll/runs/${id}/preflight`),
  createRun: (body: PayrollRunCreateInput) =>
    api<PayrollRun>('/payroll/runs', { method: 'POST', body: JSON.stringify(body) }),
  actOnRun: (id: string, body: PayrollRunActionInput) =>
    api<PayrollRun>(`/payroll/runs/${id}/actions`, { method: 'POST', body: JSON.stringify(body) }),

  payslips: (params: Record<string, string | number | undefined> = {}) =>
    api<Paginated<PayslipRow>>(`/payroll/payslips${qs(params)}`),
  myPayslips: (params: Record<string, string | number | undefined> = {}) =>
    api<Paginated<PayslipRow>>(`/payroll/payslips/me${qs(params)}`),
  payslip: (id: string) => api<Payslip>(`/payroll/payslips/${id}`),
  updatePayment: (body: PaymentUpdateInput) =>
    api<{ updated: number; status: string }>('/payroll/payslips/payment', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  report: (kind: string, params: Record<string, string | number | undefined>) =>
    api<PayrollReport>(`/payroll/reports/${kind}${qs(params)}`),
};

/**
 * Query keys, grouped so a run action can invalidate everything it touches.
 *
 * Every key here starts with 'payroll' on purpose: `all` is what the run
 * actions invalidate, and it only reaches a key that sits underneath it. A
 * single payslip used to be fetched as `['payslip', id]`, outside this tree,
 * so marking one paid never refreshed its own page.
 */
export const payrollKeys = {
  all: () => ['payroll'] as const,
  structures: () => ['payroll', 'structures'] as const,
  structure: (id: string) => ['payroll', 'structures', id] as const,
  salaries: () => ['payroll', 'salaries'] as const,
  runs: () => ['payroll', 'runs'] as const,
  run: (id: string) => ['payroll', 'runs', id] as const,
  payslips: () => ['payroll', 'payslips'] as const,
  payslip: (id: string) => ['payroll', 'payslips', id] as const,
  reports: () => ['payroll', 'reports'] as const,
  adjustments: (month: string) => ['payroll', 'adjustments', month] as const,
};

export interface PayrollAdjustment {
  id: string;
  month: string;
  amount: number;
  note: string | null;
  component: { id: string; code: string; name: string; kind: string };
  employee: { id: string; firstName: string; lastName: string; employeeCode: string };
}

/** Money, in the org currency. Compact so tables stay readable. */
export function formatMoney(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  return date.toLocaleString('en-GB', { month: 'long', year: 'numeric' });
}
