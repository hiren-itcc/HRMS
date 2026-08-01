import { defaultSettings, type OrgSettings } from '@hrms/shared';
import type { SettingsService } from './settings.service';

/**
 * Settings stub for service specs. Attendance, leave and reports all read
 * organization policy on their query paths, so every spec that constructs one
 * of those services needs this; passing overrides lets a test exercise a
 * six-day week or an April leave year without a database.
 */
export function settingsDouble(overrides: Partial<OrgSettings> = {}): SettingsService {
  const settings = { ...defaultSettings(), ...overrides };
  return { get: async () => settings } as unknown as SettingsService;
}
