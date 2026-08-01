import type { OrgSettings, OrgSettingsPatch } from '@hrms/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export const SETTINGS_KEY = ['org-settings'] as const;

export const settingsApi = {
  get: () => api<OrgSettings>('/settings'),
  patch: (patch: OrgSettingsPatch) =>
    api<OrgSettings>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};

/**
 * Org settings are read by the sidebar on every page, so they are cached for
 * five minutes rather than refetched per navigation. `undefined` while
 * loading — callers must treat "not yet known" as "show everything", never as
 * "disabled", or the nav would flicker empty on first paint.
 */
export function useOrgSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: settingsApi.get,
    staleTime: 300_000,
  });
}
