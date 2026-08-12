import { api } from '@/lib/api-client';

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  userCount: number;
  permissions: string[];
  /** Codes this role may not lose — the matrix renders these disabled. */
  locked: string[];
}

export interface PermissionGroup {
  resource: string;
  permissions: { code: string; action: string }[];
}

export interface SetPermissionsResult {
  granted: string[];
  revoked: string[];
  blocked: string[];
  permissions: string[];
  /**
   * Refresh sessions ended because their holder's grants changed. A removed
   * permission otherwise keeps working until the holder's access token expires,
   * so the API caps that window; this is reported rather than shown.
   */
  sessionsRevoked: number;
}

export const rbacApi = {
  roles: () => api<Role[]>('/roles'),
  permissions: () => api<PermissionGroup[]>('/permissions'),
  setPermissions: (roleId: string, permissions: string[]) =>
    api<SetPermissionsResult>(`/roles/${roleId}/permissions`, {
      method: 'PUT',
      body: JSON.stringify({ permissions }),
    }),
};

/** `read.own` → `Read own`; `all` stays `All`. */
export function actionTitle(action: string): string {
  const text = action.replace(/\./g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
