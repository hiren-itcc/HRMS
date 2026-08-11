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

// ── Payroll ───────────────────────────────────────────────────────────

/**
 * Statutory rules, configurable because the rates move and the ceilings move
 * with them. Defaults are the current Indian ones, but every number here is
 * an input rather than a constant so a rate change is a settings edit and
 * not a release.
 *
 * TDS is deliberately absent: real TDS needs annual projection, a regime
 * choice and investment proofs. It is entered per employee instead.
 */
export const payrollSchema = z.object({
  /** ISO 4217. Display only — no conversion happens anywhere. */
  currency: z.string().length(3).default('INR'),
  /** Day of the following month salaries are paid on. */
  payDay: z.number().int().min(1).max(31).default(1),
  /**
   * Denominator for prorating a partial month. Calendar days is the common
   * Indian practice; working days suits organizations that pay by the shift.
   */
  lopBasis: z.enum(['CALENDAR_DAYS', 'WORKING_DAYS']).default('CALENDAR_DAYS'),
  pf: z
    .object({
      enabled: z.boolean().default(true),
      employeeRate: z.number().min(0).max(100).default(12),
      employerRate: z.number().min(0).max(100).default(12),
      /** PF is statutorily capped at this monthly wage. */
      wageCeiling: z.number().min(0).default(15000),
      /** Turn off to contribute on full basic rather than the capped wage. */
      applyCeiling: z.boolean().default(true),
      /**
       * The employer's share is not one contribution — it is a pension
       * component and a provident-fund remainder, and an ECR return has to
       * report them separately.
       *
       * The pension ceiling is **its own**, and it does not follow
       * `applyCeiling`: an organization that generously contributes PF on full
       * basic still cannot put more than the statutory wage into the pension
       * scheme, because that ceiling is the government's rather than theirs.
       */
      epsRate: z.number().min(0).max(100).default(8.33),
      epsWageCeiling: z.number().min(0).default(15000),
    })
    .prefault({}),
  esi: z
    .object({
      enabled: z.boolean().default(true),
      employeeRate: z.number().min(0).max(100).default(0.75),
      employerRate: z.number().min(0).max(100).default(3.25),
      /** ESI stops applying once gross exceeds this. */
      wageThreshold: z.number().min(0).default(21000),
    })
    .prefault({}),
  professionalTax: z
    .object({
      enabled: z.boolean().default(true),
      /**
       * Ascending slabs on monthly gross; the first slab whose `upTo` the
       * gross does not exceed wins. PT is a state tax, so the amounts differ
       * by state and belong in configuration rather than in code.
       */
      slabs: z.array(z.object({ upTo: z.number().min(0), amount: z.number().min(0) })).default([
        { upTo: 15000, amount: 0 },
        { upTo: 20000, amount: 150 },
        { upTo: Number.MAX_SAFE_INTEGER, amount: 200 },
      ]),
    })
    .prefault({}),
});

// ── Employment lifecycle ──────────────────────────────────────────────

/**
 * Company-wide defaults for joining, confirming and leaving.
 *
 * Every number here is a *default*, not a rule: `Employee.noticePeriodDays`
 * and `Employee.probationMonths` override it per person, and null on the
 * employee means "whatever this says". That is why the pair exists at all —
 * a senior hire on three months' notice and a graduate on one are the normal
 * case, not an exception worth a second policy table.
 *
 * The two `auto*` switches decide whether the daily tick may act on its own.
 * An organization that wants a human to press Confirm turns the first off and
 * the tick then only surfaces the list, it does not change anybody's record.
 */
export const lifecycleSchema = z.object({
  defaultNoticeDays: z.number().int().min(0).max(365).default(30),
  defaultProbationMonths: z.number().int().min(0).max(24).default(3),
  /** Confirm at probation end automatically, or wait for HR to press it. */
  autoConfirmOnProbationEnd: z.boolean().default(true),
  /** Mark somebody EXITED once their last working date has passed. */
  autoExitOnLastWorkingDate: z.boolean().default(true),
  /**
   * Route a resignation past the reporting manager before HR sees it. Off for
   * a flat organization; also bypassed per-request when the employee has no
   * manager, because whoever is at the top of the chart has nobody to review
   * them and would otherwise be stuck at SUBMITTED forever.
   */
  requireManagerApproval: z.boolean().default(true),
});

// ── Exit checklist ────────────────────────────────────────────────────

/**
 * Who signs a clearance item off.
 *
 * `IT_ADMIN` has no matching system role — the seeded five are Admin, HR,
 * Finance, Manager and Employee. Those items fall to `employee.offboard`
 * holders until somebody composes an IT role in Settings → Roles, which the
 * RBAC editor already allows. Naming the owner anyway is what makes the list
 * useful to a human, and what lets an IT role start working the day it exists.
 */
export const CLEARANCE_OWNERS = ['MANAGER', 'HR', 'FINANCE', 'IT_ADMIN'] as const;
export const clearanceOwnerSchema = z.enum(CLEARANCE_OWNERS);
export type ClearanceOwnerCode = (typeof CLEARANCE_OWNERS)[number];

export const CLEARANCE_OWNER_LABELS: Record<ClearanceOwnerCode, string> = {
  MANAGER: 'Reporting manager',
  HR: 'HR',
  FINANCE: 'Finance',
  IT_ADMIN: 'IT / Admin',
};

/**
 * What settles an item.
 *
 * `MANUAL` is somebody signing it off. `ASSET_RETURN` reads the asset register
 * instead: it lists what the leaver still holds, settles itself when the last
 * thing comes back, and cannot be ticked to DONE by hand. Waiving it as
 * NOT_APPLICABLE with a reason still works, which is the answer for "they
 * posted it back" and for a laptop written off.
 *
 * Defaults to `MANUAL` on purpose. An organization that saved a checklist
 * before assets existed keeps hand-signing until it switches this on —
 * turning a *completion gate* on underneath an exit already in flight is the
 * one change here that could strand somebody.
 */
export const CLEARANCE_KINDS = ['MANUAL', 'ASSET_RETURN'] as const;
export const clearanceKindSchema = z.enum(CLEARANCE_KINDS);
export type ClearanceKindCode = (typeof CLEARANCE_KINDS)[number];

export const CLEARANCE_KIND_LABELS: Record<ClearanceKindCode, string> = {
  MANUAL: 'Signed off by hand',
  ASSET_RETURN: 'Read from the asset register',
};

export const clearanceItemSchema = z.object({
  label: z.string().trim().min(1, 'Give the item a name').max(120),
  description: z.string().trim().max(300).optional().nullable(),
  owner: clearanceOwnerSchema,
  /** Completion is blocked while any required item is outstanding. */
  required: z.boolean().default(true),
  kind: clearanceKindSchema.default('MANUAL'),
});
export type ClearanceItem = z.infer<typeof clearanceItemSchema>;

/**
 * The exit checklist **template**.
 *
 * Copied onto each offboarding when it starts and never joined to afterwards,
 * the way `Offboarding`'s snapshot fields and `Letter.variables` already work.
 * Editing this must not rewrite an exit that is half signed off — somebody who
 * has already returned their laptop has returned it whatever the list says
 * next week.
 *
 * "Return company assets" now carries `kind: 'ASSET_RETURN'` and reads real
 * assignments, which is what an earlier version of this comment promised would
 * happen once asset management existed. The row did not move.
 */
export const exitChecklistSchema = z.object({
  items: z
    .array(clearanceItemSchema)
    .max(30, 'That is more clearance steps than anybody will complete')
    .default([
      {
        label: 'Handover of work and responsibilities',
        description: 'Open work, passwords and anything only they know.',
        owner: 'MANAGER',
        required: true,
        kind: 'MANUAL',
      },
      {
        label: 'Return company assets',
        description: 'Laptop, access card, phone, SIM and anything else issued.',
        owner: 'IT_ADMIN',
        required: true,
        // The row this whole module was written for. New organizations get the
        // computed version; existing ones keep MANUAL until they switch it on.
        kind: 'ASSET_RETURN',
      },
      {
        label: 'Revoke system and email access',
        owner: 'IT_ADMIN',
        required: true,
        kind: 'MANUAL',
      },
      {
        label: 'Clear outstanding dues and advances',
        owner: 'FINANCE',
        required: true,
        kind: 'MANUAL',
      },
      {
        label: 'Exit interview',
        owner: 'HR',
        required: false,
        kind: 'MANUAL',
      },
      {
        label: 'Issue relieving and experience letters',
        owner: 'HR',
        required: false,
        kind: 'MANUAL',
      },
    ]),
});

// ── Full & final settlement ───────────────────────────────────────────

/**
 * What a day of pay is worth when a settlement prices one.
 *
 * 26 is the statutory divisor in the Payment of Gratuity Act and the common
 * Indian practice for encashment; 30 suits a contract written in calendar
 * days; the calendar month divides by however many days that month actually
 * had, so February pays more per day than March.
 */
export const PER_DAY_BASES = ['DAYS_26', 'DAYS_30', 'CALENDAR_MONTH'] as const;
export const perDayBasisSchema = z.enum(PER_DAY_BASES);
export type PerDayBasis = (typeof PER_DAY_BASES)[number];

export const PER_DAY_BASIS_LABELS: Record<PerDayBasis, string> = {
  DAYS_26: '26 days (statutory)',
  DAYS_30: '30 days',
  CALENDAR_MONTH: 'Days in that month',
};

/**
 * Settlement policy.
 *
 * Every figure a settlement computes is a *starting point* — each line is
 * editable before approval, because a real settlement gets negotiated and a
 * system that produces an unarguable number is one people work around in a
 * spreadsheet. These settings decide what that starting point is.
 *
 * Settlement amounts deliberately sit outside the statutory base: nothing here
 * feeds `computeStatutory`. An earning added to monthly gross would cross the
 * ESI threshold, which is a cliff rather than a taper, and switch ESI off for
 * the month. Tax on a settlement is entered by hand, exactly as monthly TDS
 * already is.
 */
export const settlementSchema = z.object({
  perDayBasis: perDayBasisSchema.default('DAYS_26'),
  /** Encashment and recovery are priced off basic unless an org says gross. */
  rateBasis: z.enum(['BASIC', 'GROSS']).default('BASIC'),
  /**
   * Recover pay for notice the employee did not serve. Off for organizations
   * that waive it as a matter of course. Never applies to an exit the employee
   * did not choose — see `settlement.calc.ts`.
   */
  recoverShortNotice: z.boolean().default(true),
  gratuity: z
    .object({
      enabled: z.boolean().default(true),
      /** Continuous service before any gratuity is owed. */
      minYears: z.number().int().min(0).max(20).default(5),
      daysPerYear: z.number().min(0).max(31).default(15),
      divisor: z.number().min(1).max(31).default(26),
      /** ₹20 lakh, the statutory ceiling. Zero means no ceiling. */
      cap: z.number().min(0).default(2_000_000),
    })
    .prefault({}),
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
  payroll: z.boolean().default(true),
  assets: z.boolean().default(true),
  wfh: z.boolean().default(true),
  expenses: z.boolean().default(true),
  performance: z.boolean().default(true),
  helpdesk: z.boolean().default(true),
});

// ── Work from home ────────────────────────────────────────────────────

/**
 * How much remote working the company allows, and whether it is agreed first.
 *
 * The cap is per week rather than per month because that is how hybrid
 * policies are actually written — "two days a week", not "nine days a month" —
 * and because a monthly figure lets somebody take the whole of one week off
 * site and still be inside it.
 */
export const wfhSchema = z.object({
  enabled: z.boolean().default(true),
  /**
   * **Zero means zero days, not "no limit"** — deliberately unlike the gratuity
   * ceiling, which uses zero as a sentinel. `Employee.remoteDaysPerWeek` can
   * legitimately be zero, because "this person never works remotely" is an
   * ordinary arrangement, and two meanings for one value would have handed
   * exactly those people unlimited remote days. No limit is seven.
   */
  maxDaysPerWeek: z.number().int().min(0).max(7).default(2),
  /**
   * Off means a request is approved the moment it is filed. For a company that
   * treats remote days as a matter of record rather than permission — which is
   * still worth recording, because attendance can then say a day was expected.
   */
  requireApproval: z.boolean().default(true),
});

// ── Registry ──────────────────────────────────────────────────────────

// ── Statutory identity ────────────────────────────────────────────────

/**
 * Who the employer is, as the government knows them.
 *
 * A settings group rather than columns on `Organization`, because these are
 * configuration edited from a screen and nothing ever queries by them — and
 * because adding a key here needs no migration, which is the whole reason that
 * table's own header comment gives for settings existing.
 *
 * Every field is optional and every one is a **precondition** rather than a
 * decoration: an ECR file without an establishment code is not a short file,
 * it is an unusable one. The filings screen refuses before a month can even be
 * chosen, so nobody discovers this at download time.
 */
export const statutorySchema = z.object({
  /** Tax deduction account number, for TDS returns. */
  tan: z.string().trim().max(15).default(''),
  /** The company's own PAN. */
  pan: z.string().trim().max(10).default(''),
  /** EPFO establishment code — the ECR header cannot be written without it. */
  pfEstablishmentCode: z.string().trim().max(25).default(''),
  /** ESIC employer code, for the contribution return. */
  esiEmployerCode: z.string().trim().max(25).default(''),
  /** Named on a return as the person responsible for it. */
  signatoryName: z.string().trim().max(120).default(''),
  signatoryDesignation: z.string().trim().max(120).default(''),
});

export type StatutorySettings = z.infer<typeof statutorySchema>;

export const orgSettingsSchema = z.object({
  workingWeek: workingWeekSchema,
  leave: leavePolicySchema,
  payroll: payrollSchema,
  lifecycle: lifecycleSchema,
  exitChecklist: exitChecklistSchema,
  settlement: settlementSchema,
  wfh: wfhSchema,
  statutory: statutorySchema,
  modules: modulesSchema,
});

/**
 * Peels `.default()` and `.prefault()` off a field.
 *
 * Two wrappers, because they are genuinely different: `default` supplies a
 * fully-formed output when the key is absent, while `prefault` supplies an
 * input that is then parsed — which is what lets a nested group fill in its
 * own defaults. `removeDefault()` only knows about the first, so a prefaulted
 * group survived into the patch schema and materialised every sibling.
 */
function unwrapDefaults(field: z.ZodTypeAny): z.ZodTypeAny {
  const withRemove = field as { removeDefault?: () => z.ZodTypeAny };
  if (withRemove.removeDefault) return unwrapDefaults(withRemove.removeDefault());
  const def = (field as { _zod?: { def?: { type?: string; innerType?: z.ZodTypeAny } } })._zod?.def;
  if (def?.type === 'prefault' && def.innerType) return unwrapDefaults(def.innerType);
  return field;
}

/**
 * Strips defaults off every field, then makes each optional.
 *
 * `.partial()` alone is not enough: it wraps a defaulted field in
 * `ZodOptional<ZodDefault<T>>`, and the inner default still fires on an
 * absent key. Parsing a patch would then materialise every default, so a
 * PATCH of one key would silently reset its siblings — writing
 * `{leave:{yearStartMonth:4}}` would clear `allowNegativeBalance`.
 */
// biome-ignore lint/suspicious/noExplicitAny: generic zod shape mapping
function asPatch<T extends z.ZodObject<any>>(schema: T): z.ZodObject<z.ZodRawShape> {
  // Annotated because the function recurses; without it TypeScript cannot
  // infer a type that refers to itself.
  const shape: z.ZodRawShape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => {
      const bare = unwrapDefaults(field as z.ZodTypeAny);
      /*
       * Recurse into nested groups. The payroll group holds `pf`, `esi` and
       * `professionalTax`, each with their own defaults — without this,
       * patching `pf.employeeRate` would reset `pf.wageCeiling` for exactly
       * the reason described above, one level down.
       */
      const patched = bare instanceof z.ZodObject ? asPatch(bare) : bare;
      return [key, patched.optional()];
    }),
  );
  return z.object(shape);
}

/** Every group optional, and every key within a group optional too. */
export const orgSettingsPatchSchema = z
  .object({
    workingWeek: asPatch(workingWeekSchema).optional(),
    leave: asPatch(leavePolicySchema).optional(),
    payroll: asPatch(payrollSchema).optional(),
    lifecycle: asPatch(lifecycleSchema).optional(),
    exitChecklist: asPatch(exitChecklistSchema).optional(),
    settlement: asPatch(settlementSchema).optional(),
    wfh: asPatch(wfhSchema).optional(),
    statutory: asPatch(statutorySchema).optional(),
    modules: asPatch(modulesSchema).optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to update' });

export type OrgSettings = z.infer<typeof orgSettingsSchema>;
export type OrgSettingsPatch = {
  [K in keyof OrgSettings]?: Partial<OrgSettings[K]>;
};
export type SettingsGroup = keyof OrgSettings;

export const SETTINGS_GROUPS = [
  'workingWeek',
  'leave',
  'payroll',
  'lifecycle',
  'exitChecklist',
  'settlement',
  'wfh',
  'statutory',
  'modules',
] as const;

/** Fully-defaulted settings — the shape a fresh organization reads. */
export function defaultSettings(): OrgSettings {
  return orgSettingsSchema.parse({
    workingWeek: {},
    leave: {},
    payroll: {},
    lifecycle: {},
    exitChecklist: {},
    settlement: {},
    wfh: {},
    statutory: {},
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
