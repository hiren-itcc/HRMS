/**
 * The reference data every organization starts with.
 *
 * These exist because a freshly bootstrapped company could not complete its
 * own first action: onboarding a hire needs a department, designation,
 * location, shift and employment type before approval passes, and a fresh
 * install had none of them. The same gap already bit pay components once —
 * only the demo seed created those, so every real deployment had a payroll
 * module it could not start using.
 *
 * All of it is a starting point, not a policy: bootstrap upserts these and
 * never overwrites, so anything an administrator renames or deletes stays
 * renamed or deleted on the next run.
 */

export interface DepartmentSeed {
  name: string;
  code: string;
}

export const DEFAULT_DEPARTMENTS: DepartmentSeed[] = [
  { name: 'Engineering', code: 'ENG' },
  { name: 'Human Resources', code: 'HR' },
  { name: 'Finance', code: 'FIN' },
  { name: 'Sales', code: 'SLS' },
  { name: 'Marketing', code: 'MKT' },
  { name: 'Operations', code: 'OPS' },
  { name: 'Administration', code: 'ADM' },
];

export interface DesignationSeed {
  title: string;
  /** Seniority, used for ordering. Gaps left so grades can be slotted in. */
  level: number;
}

export const DEFAULT_DESIGNATIONS: DesignationSeed[] = [
  { title: 'Intern', level: 1 },
  { title: 'Trainee', level: 2 },
  { title: 'Associate', level: 3 },
  { title: 'Executive', level: 4 },
  { title: 'Senior Executive', level: 5 },
  { title: 'Team Lead', level: 6 },
  { title: 'Assistant Manager', level: 7 },
  { title: 'Manager', level: 8 },
  { title: 'Senior Manager', level: 9 },
  { title: 'Director', level: 10 },
  { title: 'Chief Executive Officer', level: 12 },
];

export interface EmploymentTypeSeed {
  name: string;
  code: string;
}

export const DEFAULT_EMPLOYMENT_TYPES: EmploymentTypeSeed[] = [
  { name: 'Full-time', code: 'FT' },
  { name: 'Part-time', code: 'PT' },
  { name: 'Contract', code: 'CT' },
  { name: 'Intern', code: 'IN' },
  { name: 'Probation', code: 'PB' },
  { name: 'Consultant', code: 'CN' },
];

export interface ShiftSeed {
  name: string;
  /** "HH:MM", matching what the attendance engine parses. */
  startTime: string;
  endTime: string;
  graceMinutes: number;
}

export const DEFAULT_SHIFTS: ShiftSeed[] = [
  { name: 'General', startTime: '09:30', endTime: '18:30', graceMinutes: 15 },
  { name: 'Morning', startTime: '06:00', endTime: '14:30', graceMinutes: 15 },
  { name: 'Evening', startTime: '14:00', endTime: '22:30', graceMinutes: 15 },
  // Crosses midnight; the day-close job already handles an end before a start.
  { name: 'Night', startTime: '22:00', endTime: '06:30', graceMinutes: 15 },
];

export interface LocationSeed {
  name: string;
  type: 'HEAD_OFFICE' | 'BRANCH' | 'REMOTE' | 'CLIENT_SITE';
  country: string;
  timezone: string;
}

/**
 * One, deliberately. Beyond a head office every name is a guess, and an
 * employee assigned to an invented "Mumbai Branch" is worse than an employee
 * with nowhere to sit.
 *
 * No coordinates either: the geofence they would create decides whether an
 * office check-in is accepted, and one pointing at the wrong city rejects
 * everybody. Set them per location under Organization.
 */
export const DEFAULT_LOCATIONS: LocationSeed[] = [
  { name: 'Head Office', type: 'HEAD_OFFICE', country: 'India', timezone: 'Asia/Kolkata' },
];

export interface HolidaySeed {
  /** 1-12. */
  month: number;
  day: number;
  name: string;
}

/**
 * Fixed-date Indian public holidays only.
 *
 * Diwali, Holi, Dussehra, Janmashtami, Eid and Guru Nanak Jayanti are missing
 * on purpose: they follow lunar calendars, so no hard-coded date survives the
 * year it was written in. A holiday on the wrong day silently changes who is
 * marked absent and whose pay is docked, so the bootstrap says out loud that
 * these have to be added rather than shipping dates that will be wrong.
 */
export const DEFAULT_FIXED_HOLIDAYS: HolidaySeed[] = [
  { month: 1, day: 26, name: 'Republic Day' },
  { month: 4, day: 14, name: 'Ambedkar Jayanti' },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 8, day: 15, name: 'Independence Day' },
  { month: 10, day: 2, name: 'Gandhi Jayanti' },
  { month: 12, day: 25, name: 'Christmas Day' },
];

/** Festivals an organization must add itself — named so the reminder is specific. */
export const MOVABLE_HOLIDAY_EXAMPLES = [
  'Holi',
  'Ram Navami',
  'Eid al-Fitr',
  'Raksha Bandhan',
  'Janmashtami',
  'Ganesh Chaturthi',
  'Dussehra',
  'Diwali',
  'Guru Nanak Jayanti',
] as const;

export interface StructureLineSeed {
  componentCode: string;
  calcType: 'FLAT' | 'PERCENT_OF_BASIC' | 'PERCENT_OF_CTC' | 'STATUTORY' | 'BALANCE';
  value: number;
  order: number;
}

export interface SalaryStructureSeed {
  code: string;
  name: string;
  description: string;
  lines: StructureLineSeed[];
}

/**
 * The structure a new organization can assign on day one.
 *
 * There is no PF or professional-tax line, and that is not an omission.
 * `calculatePayslip` pushes both from the statutory engine *before* it walks
 * the structure lines, then skips any component already present — so a
 * `FLAT 1800` PF line would be stored, displayed, and never used. Both figures
 * live in Settings → Payroll instead, where the shipped defaults already give
 * the standard Indian numbers: PF is 12% of basic capped at a ₹15,000 wage
 * ceiling (₹1,800), and professional tax is the ₹200 slab above ₹20,000 gross.
 */
export const DEFAULT_SALARY_STRUCTURES: SalaryStructureSeed[] = [
  {
    code: 'STANDARD',
    name: 'Standard',
    description: 'Basic 50% of CTC, HRA 40% of basic, special allowance absorbs the balance.',
    lines: [
      { componentCode: 'BASIC', calcType: 'PERCENT_OF_CTC', value: 50, order: 1 },
      { componentCode: 'HRA', calcType: 'PERCENT_OF_BASIC', value: 40, order: 2 },
      // At most one BALANCE line per structure; this is it, and it is what
      // makes the earnings add up to CTC exactly at any salary.
      { componentCode: 'SPECIAL', calcType: 'BALANCE', value: 0, order: 3 },
    ],
  },
];
