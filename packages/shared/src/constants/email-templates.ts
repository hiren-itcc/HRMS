/**
 * Built-in email templates. These are the fallback that ships in the binary:
 * a template row can be edited from Settings, and the sender drops back to the
 * default here rather than sending nothing.
 *
 * Rows are created lazily — the first edit upserts one — so most organizations
 * have no rows at all and every send uses the copy below.
 */
export interface EmailTemplateDefault {
  key: string;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  /** Names usable as {{variable}} in the subject and body. */
  variables: string[];
  /** Whether it sends before anybody has touched it in Settings. */
  active: boolean;
  /**
   * Whether switching it off in Settings actually stops the mail.
   *
   * `false` means it does — these are notifications, and an organization that
   * turns one off has said what it wants.
   *
   * `true` means it does not: the send falls back to the shipped copy and goes
   * out anyway. A password reset nobody receives is an account nobody can get
   * back into, and an invite nobody receives is a hire who cannot start. A bad
   * edit — or a switch flicked without thinking about it — must not be able to
   * cause either.
   */
  required: boolean;
}

export const EMAIL_TEMPLATES: EmailTemplateDefault[] = [
  {
    key: 'password_reset',
    name: 'Password reset',
    description: 'Sent when someone asks to reset their password.',
    subject: 'Reset your {{orgName}} password',
    bodyHtml: [
      '<p>Hello,</p>',
      '<p>We received a request to reset the password for <strong>{{email}}</strong>.</p>',
      '<p><a href="{{resetUrl}}">Choose a new password</a></p>',
      '<p>This link expires in {{expiryMinutes}} minutes. If you did not ask for this, you can ignore this email.</p>',
      '<p>— {{orgName}}</p>',
    ].join('\n'),
    variables: ['orgName', 'email', 'resetUrl', 'expiryMinutes'],
    active: true,
    required: true,
  },
  {
    key: 'employee_invite',
    name: 'Employee invitation',
    description:
      'Sent to a new hire’s personal address to start onboarding. States their work email as the login ID and carries a single-use link.',
    subject: 'Welcome to {{orgName}} — set up your account',
    bodyHtml: [
      '<p>Hello {{firstName}},</p>',
      '<p>{{inviterName}} has invited you to join <strong>{{orgName}}</strong>. The link below sets your password and starts your onboarding.</p>',
      '<p><a href="{{inviteUrl}}">Set your password and begin</a></p>',
      '<p>Your sign-in address from now on is <strong>{{workEmail}}</strong>.</p>',
      '<p>This link can be used once and expires in {{expiryDays}} days. If it has already expired, ask {{inviterName}} to send a new one.</p>',
      '<p>— {{orgName}}</p>',
    ].join('\n'),
    variables: ['orgName', 'firstName', 'inviterName', 'inviteUrl', 'workEmail', 'expiryDays'],
    active: true,
    required: true,
  },
  {
    key: 'leave_approved',
    name: 'Leave approved',
    description: 'Sent to an employee when their leave request is approved.',
    subject: 'Your leave from {{startDate}} has been approved',
    bodyHtml: [
      '<p>Hello {{firstName}},</p>',
      '<p>Your {{leaveType}} from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> ({{days}} days) has been approved by {{approverName}}.</p>',
      '<p>— {{orgName}}</p>',
    ].join('\n'),
    variables: [
      'orgName',
      'firstName',
      'leaveType',
      'startDate',
      'endDate',
      'days',
      'approverName',
    ],
    active: true,
    required: false,
  },
  {
    key: 'leave_rejected',
    name: 'Leave declined',
    description: 'Sent to an employee when their leave request is declined.',
    subject: 'Your leave request was declined',
    bodyHtml: [
      '<p>Hello {{firstName}},</p>',
      '<p>Your {{leaveType}} from <strong>{{startDate}}</strong> to <strong>{{endDate}}</strong> was declined by {{approverName}}.</p>',
      '<p>{{approverNote}}</p>',
      '<p>— {{orgName}}</p>',
    ].join('\n'),
    variables: [
      'orgName',
      'firstName',
      'leaveType',
      'startDate',
      'endDate',
      'approverName',
      'approverNote',
    ],
    active: true,
    required: false,
  },
  {
    key: 'notification_generic',
    name: 'Notification',
    description:
      'The email behind every in-app notification that has no template of its own — a resignation moving through approval, an exit completing, a claim decided. Switching it off leaves the bell working and stops the mail.',
    subject: '{{title}}',
    bodyHtml: [
      '<p>{{title}}</p>',
      '<p>{{body}}</p>',
      '<p><a href="{{linkUrl}}">Open it in {{orgName}}</a></p>',
      '<p>— {{orgName}}</p>',
    ].join('\n'),
    variables: ['orgName', 'title', 'body', 'linkUrl'],
    active: true,
    required: false,
  },
];

export function emailTemplateDefault(key: string): EmailTemplateDefault | undefined {
  return EMAIL_TEMPLATES.find((t) => t.key === key);
}
