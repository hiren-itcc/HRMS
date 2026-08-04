import type { DocumentCategoryCreateInput } from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api, fetchBlob, uploadFile } from '@/lib/api-client';
import { qs } from '@/lib/crud';

export interface DocumentFolder {
  id: string;
  name: string;
  documentCount: number;
}

export interface EmployeeDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
  categoryId: string | null;
  category: { id: string; name: string } | null;
}

/** A row of the org-wide list — the same document, plus who it belongs to. */
export interface AdminDocument extends EmployeeDocument {
  employeeId: string | null;
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
  } | null;
}

export const documentsApi = {
  folders: (employeeId?: string) =>
    api<DocumentFolder[]>(`/documents/categories${qs({ employeeId })}`),
  createFolder: (input: DocumentCategoryCreateInput) =>
    api<DocumentFolder>('/documents/categories', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  renameFolder: (id: string, input: DocumentCategoryCreateInput) =>
    api<DocumentFolder>(`/documents/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeFolder: (id: string) => api<void>(`/documents/categories/${id}`, { method: 'DELETE' }),

  list: (employeeId: string, params: { categoryId?: string; search?: string } = {}) =>
    api<EmployeeDocument[]>(`/employees/${employeeId}/documents${qs(params)}`),

  /** Org-wide, behind `document.read` — the HR view, paginated. */
  listAll: (params: {
    employeeId?: string;
    categoryId?: string;
    search?: string;
    page: number;
    limit: number;
  }) =>
    api<Paginated<AdminDocument>>(
      `/documents${qs({
        employeeId: params.employeeId,
        categoryId: params.categoryId,
        search: params.search,
        page: String(params.page),
        limit: String(params.limit),
      })}`,
    ),

  upload: (
    employeeId: string,
    file: File,
    categoryId: string | undefined,
    onProgress: (percent: number) => void,
  ) => {
    const form = new FormData();
    form.append('file', file);
    if (categoryId) form.append('categoryId', categoryId);
    return uploadFile<EmployeeDocument>(`/employees/${employeeId}/documents`, form, onProgress);
  },

  move: (id: string, categoryId: string | null) =>
    api<EmployeeDocument>(`/documents/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId }),
    }),

  fileBlob: (id: string) => fetchBlob(`/documents/${id}/file`),
  remove: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }),
};

export const ACCEPTED_TYPES =
  'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp';

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}

/** DOCX cannot render in-browser — offered as download instead. */
export function isPreviewable(mimeType: string): boolean {
  return isPdf(mimeType) || isImage(mimeType);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function fileKindLabel(mimeType: string): string {
  if (isPdf(mimeType)) return 'PDF';
  if (isImage(mimeType)) return mimeType.replace('image/', '').toUpperCase();
  if (mimeType.includes('wordprocessingml')) return 'DOCX';
  return 'File';
}
