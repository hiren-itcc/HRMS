import type { LetterTemplateUpdateInput } from '@hrms/shared';
import { api } from '@/lib/api-client';

export type LetterStatus = 'ISSUED' | 'VOID';

/** List row — deliberately without the body, which can be long. */
export interface LetterListItem {
  id: string;
  templateKey: string;
  letterNumber: string;
  title: string;
  employeeName: string;
  employeeCode: string;
  containsSalary: boolean;
  status: LetterStatus;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface Letter extends LetterListItem {
  bodyHtml: string;
  departmentName: string | null;
  designationName: string | null;
  issuedById: string;
  voidedById: string | null;
}

export interface LetterPreview {
  title: string;
  bodyHtml: string;
  containsSalary: boolean;
  /** Non-empty means Issue must not be offered. */
  blockers: string[];
}

export interface LetterTemplate {
  key: string;
  name: string;
  description: string;
  title: string;
  bodyHtml: string;
  variables: string[];
  containsSalary: boolean;
  isCustomised: boolean;
  issuedCount: number;
  updatedAt: string | null;
}

export const lettersApi = {
  forEmployee: (employeeId: string) => api<LetterListItem[]>(`/employees/${employeeId}/letters`),
  mine: () => api<LetterListItem[]>('/me/letters'),
  get: (id: string) => api<Letter>(`/letters/${id}`),
  preview: (employeeId: string, templateKey: string) =>
    api<LetterPreview>(
      `/letters/preview?employeeId=${encodeURIComponent(employeeId)}&templateKey=${encodeURIComponent(templateKey)}`,
    ),
  issue: (employeeId: string, templateKey: string) =>
    api<LetterListItem>('/letters', {
      method: 'POST',
      body: JSON.stringify({ employeeId, templateKey }),
    }),
  void: (id: string, reason: string) =>
    api<LetterListItem>(`/letters/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export const letterTemplatesApi = {
  list: () => api<LetterTemplate[]>('/letters/templates'),
  update: (key: string, input: LetterTemplateUpdateInput) =>
    api<LetterTemplate>(`/letters/templates/${key}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  reset: (key: string) => api<LetterTemplate>(`/letters/templates/${key}`, { method: 'DELETE' }),
};

export const letterKeys = {
  all: () => ['letters'] as const,
  forEmployee: (employeeId: string) => ['letters', 'employee', employeeId] as const,
  mine: () => ['letters', 'mine'] as const,
  one: (id: string) => ['letters', id] as const,
  templates: () => ['letters', 'templates'] as const,
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export function formatLetterDate(iso: string): string {
  return dateFmt.format(new Date(iso));
}
