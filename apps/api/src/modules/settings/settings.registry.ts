import {
  defaultSettings,
  type OrgSettings,
  orgSettingsSchema,
  SETTINGS_GROUPS,
  type SettingsGroup,
} from '@hrms/shared';

/**
 * Pure merge of stored `Setting` rows over the defaults — no Prisma, no I/O.
 */

export interface SettingRow {
  key: string;
  value: unknown;
}

/**
 * A stored group that no longer parses (a key removed in a later release, a
 * hand-edited row) falls back to its default rather than 500-ing every page
 * that reads settings. Settings are read on the critical path of attendance
 * and leave; a corrupt row must degrade, not break.
 */
export function mergeSettings(rows: SettingRow[]): OrgSettings {
  const merged = defaultSettings();
  const stored = new Map(rows.map((r) => [r.key, r.value]));

  for (const group of SETTINGS_GROUPS) {
    const raw = stored.get(group);
    if (raw === undefined) continue;
    const parsed = orgSettingsSchema.shape[group].safeParse(raw);
    if (parsed.success) {
      assign(merged, group, parsed.data);
    }
  }
  return merged;
}

function assign<K extends SettingsGroup>(target: OrgSettings, key: K, value: OrgSettings[K]): void {
  target[key] = value;
}
