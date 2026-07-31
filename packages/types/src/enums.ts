/**
 * Domain enums shared web <-> api.
 * Keep in sync with apps/api/prisma/schema.prisma — the Prisma enums are the
 * source of truth; these mirror them for consumers that must not depend on
 * the generated Prisma client (i.e. the frontend).
 */

export const UserStatus = {
  INVITED: 'INVITED',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const RoleCode = {
  ADMIN: 'ADMIN',
  HR: 'HR',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
} as const;
export type RoleCode = (typeof RoleCode)[keyof typeof RoleCode];

export const EmployeeStatus = {
  ACTIVE: 'ACTIVE',
  ON_NOTICE: 'ON_NOTICE',
  EXITED: 'EXITED',
} as const;
export type EmployeeStatus = (typeof EmployeeStatus)[keyof typeof EmployeeStatus];

export const LocationType = {
  HEAD_OFFICE: 'HEAD_OFFICE',
  BRANCH: 'BRANCH',
  REMOTE: 'REMOTE',
  CLIENT_SITE: 'CLIENT_SITE',
} as const;
export type LocationType = (typeof LocationType)[keyof typeof LocationType];

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  OTHER: 'OTHER',
  PREFER_NOT_TO_SAY: 'PREFER_NOT_TO_SAY',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const ApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];

export const AttendanceStatus = {
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  HALF_DAY: 'HALF_DAY',
  ON_LEAVE: 'ON_LEAVE',
  HOLIDAY: 'HOLIDAY',
  WEEK_OFF: 'WEEK_OFF',
  WFH: 'WFH',
} as const;
export type AttendanceStatus = (typeof AttendanceStatus)[keyof typeof AttendanceStatus];

export const AttendanceSource = {
  WEB: 'WEB',
  MOBILE: 'MOBILE',
  ADMIN: 'ADMIN',
  IMPORT: 'IMPORT',
} as const;
export type AttendanceSource = (typeof AttendanceSource)[keyof typeof AttendanceSource];

export const HalfDaySide = {
  FIRST_HALF: 'FIRST_HALF',
  SECOND_HALF: 'SECOND_HALF',
} as const;
export type HalfDaySide = (typeof HalfDaySide)[keyof typeof HalfDaySide];

export const DocVisibility = {
  PRIVATE: 'PRIVATE',
  ORG: 'ORG',
} as const;
export type DocVisibility = (typeof DocVisibility)[keyof typeof DocVisibility];

export const Audience = {
  ALL: 'ALL',
  DEPARTMENT: 'DEPARTMENT',
  LOCATION: 'LOCATION',
} as const;
export type Audience = (typeof Audience)[keyof typeof Audience];
