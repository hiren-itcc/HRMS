import { api, fetchBlob, uploadFile } from '@/lib/api-client';

export interface EmployeeDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string;
  createdAt: string;
}

export const documentsApi = {
  list: (employeeId: string) => api<EmployeeDocument[]>(`/employees/${employeeId}/documents`),

  upload: (employeeId: string, file: File, onProgress: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return uploadFile<EmployeeDocument>(`/employees/${employeeId}/documents`, form, onProgress);
  },

  fileBlob: (id: string) => fetchBlob(`/documents/${id}/file`),

  remove: (id: string) => api<void>(`/documents/${id}`, { method: 'DELETE' }),
};

export const ACCEPTED_TYPES =
  'application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp';

export function isPreviewable(mimeType: string): boolean {
  return mimeType === 'application/pdf' || mimeType.startsWith('image/');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
