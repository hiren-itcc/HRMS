import type { EmailTemplateUpdateInput } from '@hrms/shared';
import { api } from '@/lib/api-client';

export interface EmailTemplate {
  key: string;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  variables: string[];
  isActive: boolean;
  /** False when nothing sends this template yet. */
  hasSender: boolean;
  isCustomised: boolean;
  updatedAt: string | null;
}

export const emailApi = {
  list: () => api<EmailTemplate[]>('/settings/email-templates'),
  update: (key: string, input: EmailTemplateUpdateInput) =>
    api<EmailTemplate>(`/settings/email-templates/${key}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  reset: (key: string) =>
    api<EmailTemplate>(`/settings/email-templates/${key}`, { method: 'DELETE' }),
};

/** Stand-in values so the preview reads like a real email. */
export const SAMPLE_VALUES: Record<string, string> = {
  orgName: 'Acme Industries',
  email: 'asha.verma@acme.test',
  resetUrl: 'https://hrms.acme.test/reset-password?token=sample',
  expiryMinutes: '60',
  firstName: 'Asha',
  inviterName: 'Meera Manager',
  inviteUrl: 'https://hrms.acme.test/invite?token=sample',
  leaveType: 'Casual Leave',
  startDate: '14 Sep 2026',
  endDate: '16 Sep 2026',
  days: '3',
  approverName: 'Meera Manager',
  approverNote: 'Enjoy the break.',
};

/**
 * Fills placeholders with sample values for the on-screen preview. Unknown
 * placeholders are left visible, matching what the server-side renderer does,
 * so the preview cannot imply a variable works when it does not.
 */
export function previewTemplate(template: string): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    name in SAMPLE_VALUES ? (SAMPLE_VALUES[name] as string) : match,
  );
}
