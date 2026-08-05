/**
 * Built-in letter templates — the fallback that ships in the binary, exactly
 * as the email templates do: a row exists only when an organization edits one,
 * absence means "use the default", and Reset deletes the row.
 *
 * Unlike an email, a letter is never sent automatically. A human previews it
 * and clicks Issue, so there is no `active` flag here — a bad edit cannot
 * silently break a background sender, and Reset already covers it.
 */
export interface LetterTemplateDefault {
  key: string;
  name: string;
  description: string;
  /** The heading printed on the page — the letters analogue of a subject. */
  title: string;
  bodyHtml: string;
  /** Names usable as {{variable}} in the title and body. */
  variables: string[];
  /**
   * True when the shipped copy quotes pay. This is only the starting value:
   * the issued letter's own flag is recomputed from the variables the
   * (possibly customised) body actually uses, so an org that drops
   * {{monthlyCtc}} into its appointment letter cannot slip the salary gate.
   */
  containsSalary: boolean;
  /** Reference-number prefix — OFR/2026/0007. */
  numberPrefix: string;
}

/** Present in every template, so the variable builder always supplies them. */
export const COMMON_LETTER_VARIABLES = [
  'orgName',
  'letterNumber',
  'issueDate',
  'employeeName',
  'employeeCode',
  'designation',
  'department',
  'issuedByName',
] as const;

/**
 * Using any of these forces `containsSalary` on the issued letter, whatever
 * the catalogue says. The gate follows the content, not the template name.
 */
export const SALARY_VARIABLES = ['monthlyCtc', 'annualCtc'] as const;

const SIGN_OFF = [
  '<p>Yours sincerely,</p>',
  '<p><strong>{{issuedByName}}</strong><br />{{orgName}}</p>',
].join('\n');

export const LETTER_TEMPLATES: LetterTemplateDefault[] = [
  {
    key: 'offer_letter',
    name: 'Offer letter',
    description: 'Offers employment before joining — states the role and the pay offered.',
    title: 'Letter of Offer',
    bodyHtml: [
      '<p>Dear {{employeeName}},</p>',
      '<p>We are pleased to offer you the position of <strong>{{designation}}</strong> in our {{department}} team at {{orgName}}.</p>',
      '<p>Your appointment is expected to commence on <strong>{{joinDate}}</strong> at our {{location}} office, on a {{employmentType}} basis.</p>',
      '<p>Your remuneration will be <strong>{{monthlyCtc}} per month</strong> ({{annualCtc}} per annum), inclusive of all applicable allowances and subject to statutory deductions.</p>',
      '<p>This offer is subject to verification of the documents and references you have provided.</p>',
      '<p>We look forward to welcoming you.</p>',
      SIGN_OFF,
    ].join('\n'),
    variables: [
      ...COMMON_LETTER_VARIABLES,
      'joinDate',
      'location',
      'employmentType',
      'monthlyCtc',
      'annualCtc',
    ],
    containsSalary: true,
    numberPrefix: 'OFR',
  },
  {
    key: 'appointment_letter',
    name: 'Joining / appointment letter',
    description:
      'Confirms the appointment on joining. Quotes no pay, so it can be issued before a salary is assigned.',
    title: 'Letter of Appointment',
    bodyHtml: [
      '<p>Dear {{employeeName}},</p>',
      '<p>Further to your acceptance of our offer, we confirm your appointment as <strong>{{designation}}</strong> in the {{department}} department at {{orgName}}, with effect from <strong>{{joinDate}}</strong>.</p>',
      '<p>Your employee code is <strong>{{employeeCode}}</strong>. You will be based at {{location}} on a {{employmentType}} basis and will report to {{managerName}}.</p>',
      '<p>Your employment is governed by the policies of {{orgName}} as amended from time to time.</p>',
      '<p>We are glad to have you with us.</p>',
      SIGN_OFF,
    ].join('\n'),
    variables: [
      ...COMMON_LETTER_VARIABLES,
      'joinDate',
      'location',
      'employmentType',
      'managerName',
    ],
    containsSalary: false,
    numberPrefix: 'APT',
  },
  /*
   * Separate from the experience certificate, though the two are often
   * confused. A relieving letter says the employment is over and nothing is
   * owed — it is what the next employer asks for. An experience certificate
   * says what somebody did and how well; it is a reference. They are issued at
   * the same moment and are not the same document, so a company that has to
   * produce both should not have to edit one template twice.
   *
   * `REL`, not `EXP`: letter numbers are sequential per prefix per year, and
   * two templates sharing one would collide on the unique constraint.
   *
   * Uses only variables `buildLetterVars` already supplies. Declaring one it
   * does not would make every issue of this template throw, because
   * `missingVariables()` unions declared with used.
   */
  {
    key: 'relieving_letter',
    name: 'Relieving letter',
    description:
      'Confirms the employment has ended and the exit formalities are complete. Issued on the last working day.',
    title: 'Relieving Letter',
    bodyHtml: [
      '<p>To whomsoever it may concern,</p>',
      '<p>This is to confirm that <strong>{{employeeName}}</strong> (employee code {{employeeCode}}) has been relieved from the services of {{orgName}} with effect from the close of business on <strong>{{exitDate}}</strong>.</p>',
      '<p>They joined us on {{joinDate}} and at the time of leaving held the position of <strong>{{designation}}</strong> in the {{department}} department, a total tenure of {{tenure}}.</p>',
      '<p>All exit formalities have been completed and there are no dues outstanding on either side.</p>',
      '<p>We thank them for their service and wish them well.</p>',
      SIGN_OFF,
    ].join('\n'),
    variables: [...COMMON_LETTER_VARIABLES, 'joinDate', 'exitDate', 'tenure'],
    containsSalary: false,
    numberPrefix: 'REL',
  },
  {
    key: 'experience_letter',
    name: 'Experience certificate',
    description:
      'Confirms tenure and role, as a reference. Issued to a serving employee it reads "to present".',
    title: 'Experience Certificate',
    bodyHtml: [
      '<p>To whomsoever it may concern,</p>',
      '<p>This is to certify that <strong>{{employeeName}}</strong> (employee code {{employeeCode}}) was employed with {{orgName}} from <strong>{{joinDate}}</strong> to <strong>{{exitDate}}</strong>, a period of {{tenure}}.</p>',
      '<p>At the time of leaving, {{employeeName}} held the position of <strong>{{designation}}</strong> in the {{department}} department.</p>',
      '<p>We found their conduct and performance satisfactory, and we wish them well in their future endeavours.</p>',
      SIGN_OFF,
    ].join('\n'),
    variables: [...COMMON_LETTER_VARIABLES, 'joinDate', 'exitDate', 'tenure'],
    containsSalary: false,
    numberPrefix: 'EXP',
  },
  {
    key: 'salary_certificate',
    name: 'Salary certificate',
    description: 'States current salary for a bank or visa application.',
    title: 'Salary Certificate',
    bodyHtml: [
      '<p>To whomsoever it may concern,</p>',
      '<p>This is to certify that <strong>{{employeeName}}</strong> (employee code {{employeeCode}}) has been employed with {{orgName}} since <strong>{{joinDate}}</strong> and currently holds the position of <strong>{{designation}}</strong> in the {{department}} department.</p>',
      '<p>Their present remuneration is <strong>{{monthlyCtc}} per month</strong> ({{annualCtc}} per annum), subject to statutory deductions.</p>',
      '<p>This certificate is issued on request for the purpose of {{employeeName}}’s personal records.</p>',
      SIGN_OFF,
    ].join('\n'),
    variables: [...COMMON_LETTER_VARIABLES, 'joinDate', 'monthlyCtc', 'annualCtc'],
    containsSalary: true,
    numberPrefix: 'SAL',
  },
];

export function letterTemplateDefault(key: string): LetterTemplateDefault | undefined {
  return LETTER_TEMPLATES.find((t) => t.key === key);
}

export const LETTER_TEMPLATE_KEYS = LETTER_TEMPLATES.map((t) => t.key);
