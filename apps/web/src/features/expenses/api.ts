import type {
  ExpenseCategoryCreateInput,
  ExpenseCategoryUpdateInput,
  ExpenseClaimCreateInput,
  ExpenseClaimStatusCode,
  ExpenseClaimUpdateInput,
  ExpenseDecisionInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

/**
 * Expense claims.
 *
 * Every amount here is `number`, and that is only true because
 * `expenses.mapper.ts` converts on the way out — Prisma's `Decimal` serializes
 * to JSON as a string, and a screen formatting a string shows `NaN` with no
 * stack trace to find it by.
 */

export interface ExpenseCategory {
  id: string;
  code: string;
  name: string;
  /** Null means no ceiling — not a ceiling of zero. */
  capPerClaim: number | null;
  requiresReceipt: boolean;
  componentId: string;
  component?: { id: string; code: string; name: string; kind: string };
  active: boolean;
  order: number;
}

export interface ExpenseItem {
  id: string;
  categoryId: string;
  category?: { id: string; name: string; code: string };
  spentOn: string;
  amount: number;
  description: string;
  receiptId: string | null;
}

export interface ExpenseClaim {
  id: string;
  employeeId: string;
  employee?: { id: string; firstName: string; lastName: string; employeeCode: string };
  title: string;
  status: ExpenseClaimStatusCode;
  payrollMonth: string | null;
  /**
   * Derived from payroll, never stored: whether the run for `payrollMonth` was
   * published. "Approved" and "you have the money" are different questions and
   * the screens say both.
   */
  paid: boolean;
  total: number;
  itemCount: number;
  items: ExpenseItem[];
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface ExpenseClaimListRequest extends ListRequest {
  status?: ExpenseClaimStatusCode;
  employeeId?: string;
  scope?: 'own' | 'team' | 'all';
}

export const expenseKeys = {
  all: () => ['expenses'] as const,
  list: (params: ExpenseClaimListRequest) => ['expenses', 'list', params] as const,
  one: (id: string) => ['expenses', id] as const,
  categories: () => ['expenses', 'categories'] as const,
  allCategories: () => ['expenses', 'categories', 'all'] as const,
};

export const expensesApi = {
  list: (params: ExpenseClaimListRequest) => api<Paginated<ExpenseClaim>>(`/expenses${qs(params)}`),
  get: (id: string) => api<ExpenseClaim>(`/expenses/${id}`),
  create: (input: ExpenseClaimCreateInput) =>
    api<ExpenseClaim>('/expenses', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ExpenseClaimUpdateInput) =>
    api<ExpenseClaim>(`/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  submit: (id: string) => api<ExpenseClaim>(`/expenses/${id}/submit`, { method: 'POST' }),
  withdraw: (id: string) => api<ExpenseClaim>(`/expenses/${id}/withdraw`, { method: 'POST' }),
  approve: (id: string, input: ExpenseDecisionInput) =>
    api<ExpenseClaim>(`/expenses/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reject: (id: string, input: ExpenseDecisionInput) =>
    api<ExpenseClaim>(`/expenses/${id}/reject`, { method: 'POST', body: JSON.stringify(input) }),

  categories: () => api<ExpenseCategory[]>('/expenses/categories'),
  allCategories: () => api<ExpenseCategory[]>('/expenses/categories/all'),
  createCategory: (input: ExpenseCategoryCreateInput) =>
    api<ExpenseCategory>('/expenses/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCategory: (id: string, input: ExpenseCategoryUpdateInput) =>
    api<ExpenseCategory>(`/expenses/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeCategory: (id: string) =>
    api<{ id: string }>(`/expenses/categories/${id}`, { method: 'DELETE' }),
};
