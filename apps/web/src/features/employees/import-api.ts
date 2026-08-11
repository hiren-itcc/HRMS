import type { ImportMode, ImportPreview, ImportResult } from '@hrms/shared';
import { api } from '@/lib/api-client';

/**
 * Bulk import. Two steps, and the first one writes nothing — which is what
 * makes the second one safe to run per row rather than in one transaction.
 */
export const importKeys = {
  all: () => ['employee-import'] as const,
  one: (id: string) => ['employee-import', id] as const,
};

export const employeeImportApi = {
  preview: (file: File, mode: ImportMode) => {
    const body = new FormData();
    body.append('file', file);
    // FormData, so no Content-Type header — the browser has to set the
    // multipart boundary itself and overriding it breaks the upload.
    return api<ImportPreview>(`/employees/import/preview?mode=${mode}`, { method: 'POST', body });
  },
  commit: (id: string, sendInvites: boolean) =>
    api<ImportResult>(`/employees/import/${id}/commit`, {
      method: 'POST',
      body: JSON.stringify({ sendInvites }),
    }),
  get: (id: string) => api<ImportResult>(`/employees/import/${id}`),
};

/** Where the template and the export live — plain links, not fetches. */
export const importTemplateUrl = `${process.env.NEXT_PUBLIC_API_URL ?? ''}/employees/import/template`;
