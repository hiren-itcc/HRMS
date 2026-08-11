import { installValidationMessages } from './validation-messages';

/*
 * Installed here rather than at each call site: importing any schema from this
 * package now carries the message map with it, and a parse cannot happen
 * without one of these imports. Registering it in the app instead would leave
 * whichever app forgot showing zod's developer-facing defaults.
 */
installValidationMessages();

export * from './constants/email-templates';
export * from './constants/exit-interview';
export * from './constants/letter-templates';
export * from './constants/org-defaults';
export * from './constants/pay-components';
export * from './constants/permissions';
export * from './schemas/announcement';
export * from './schemas/asset';
export * from './schemas/attendance';
export * from './schemas/audit';
export * from './schemas/auth';
export * from './schemas/careers';
export * from './schemas/common';
export * from './schemas/document';
export * from './schemas/employee';
export * from './schemas/expense';
export * from './schemas/leave';
export * from './schemas/letter';
export * from './schemas/notification';
export * from './schemas/offboarding';
export * from './schemas/onboarding';
export * from './schemas/organization';
export * from './schemas/payroll';
export * from './schemas/performance';
export * from './schemas/recruitment';
export * from './schemas/report';
export * from './schemas/resignation';
export * from './schemas/settings';
export * from './schemas/settlement';
export * from './schemas/wfh';
export * from './validation-messages';
