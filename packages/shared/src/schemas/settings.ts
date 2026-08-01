import { z } from 'zod';

/**
 * Organization settings — a typed registry over the `Setting` key-value rows
 * (docs/03 §Settings). Each top-level group is stored as one row, so patching
 * one group never rewrites another and adding a key needs no migration.
 *
 * Every field has a default, so a fresh organization needs no seeding: the
 * service merges stored rows over these.
 */

// ── Working week ──────────────────────────────────────────────────────

/** 0 = Sunday … 6 = Saturday, matching `Date.getUTCDay()`. */
export const WEEKDAYS = [
  { value: 0, label: 'Sunday', short: 'Sun' },
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
] as const;

export const workingWeekSchema = z.object({
  /**
   * Non-working days. Drives WEEK_OFF in attendance and the days a leave
   * request skips — one definition so the two can never disagree.
   */
  weekOffDays: z
    .array(z.number().int().min(0).max(6))
    .max(6, 'At least one day must be a working day')
    .transform((days) => [...new Set(days)].sort((a, b) => a - b))
    .default([0, 6]),
  /** First column of month calendars. Independent of `weekOffDays`. */
  weekStartsOn: z.number().int().min(0).max(6).default(1),
});

// ── Leave policy ──────────────────────────────────────────────────────

export const leavePolicySchema = z.object({
  /**
   * Month the leave year starts in. 1 = calendar year (Jan–Dec), 4 = the
   * Indian financial year (Apr–Mar). A request is booked against the leave
   * year its start date falls in.
   */
  yearStartMonth: z.number().int().min(1).max(12).default(1),
  /** Let an employee book leave they have not accrued yet. */
  allowNegativeBalance: z.boolean().default(false),
});

// ── Modules ───────────────────────────────────────────────────────────

/**
 * Presentation only, never authorization. Turning a module off hides its
 * navigation entry; permissions remain the security boundary, so a disabled
 * module's API is still reachable by anyone who holds its permissions.
 */
export const modulesSchema = z.object({
  attendance: z.boolean().default(true),
  leave: z.boolean().default(true),
  documents: z.boolean().default(true),
  announcements: z.boolean().default(true),
  reports: z.boolean().default(true),
});

// ── Registry ──────────────────────────────────────────────────────────

export const orgSettingsSchema = z.object({
  workingWeek: workingWeekSchema,
  leave: leavePolicySchema,
  modules: modulesSchema,
});

/**
 * Strips `.default()` off every field, then makes each optional.
 *
 * `.partial()` alone is not enough: it wraps a defaulted field in
 * `ZodOptional<ZodDefault<T>>`, and the inner default still fires on an
 * absent key. Parsing a patch would then materialise every default, so a
 * PATCH of one key would silently reset its siblings — writing
 * `{leave:{yearStartMonth:4}}` would clear `allowNegativeBalance`.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic zod shape mapping
function asPatch<T extends z.ZodObject<any>>(schema: T) {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const inner = field as { removeDefault?: () => z.ZodTypeAny };
      return [
        key,
        (inner.removeDefault ? inner.removeDefault() : (field as z.ZodTypeAny)).optional(),
      ];
    }),
  );
  return z.object(shape);
}

/** Every group optional, and every key within a group optional too. */
export const orgSettingsPatchSchema = z
  .object({
    workingWeek: asPatch(workingWeekSchema).optional(),
    leave: asPatch(leavePolicySchema).optional(),
    modules: asPatch(modulesSchema).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export type OrgSettingsPatch = {
  [K in keyof OrgSettings]?: Partial<OrgSettings[K]>;
};
export type SettingsGroup = keyof OrgSettings;

export const SETTINGS_GROUPS = ['workingWeek', 'leave', 'modules'] as const;

/** Fully-defaulted settings — the shape a fresh organization reads. */
export function defaultSettings(): OrgSettings {
  return orgSettingsSchema.parse({
    workingWeek: {},
    leave: {},
    modules: {},
  });
}

// ── Email templates ───────────────────────────────────────────────────

export const emailTemplateUpdateSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  bodyHtml: z.string().trim().min(1, 'Body is required').max(20_000),
  isActive: z.boolean(),
});
export type EmailTemplateUpdateInput = z.infer<typeof emailTemplateUpdateSchema>;
