import type { RoleCodeInput } from '@hrms/shared';
import type { EmployeeStatus, Gender } from '@hrms/types';

interface Ref {
  id: string;
  name: string;
}

export interface EmployeeListItem {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  phone: string | null;
  avatarUrl: string | null;
  status: EmployeeStatus;
  joinDate: string;
  department: Ref | null;
  designation: { id: string; title: string } | null;
  location: Ref | null;
}

export interface BankDetail {
  id: string;
  accountHolderName: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string | null;
  branch: string | null;
}

export type ProbationState = 'NONE' | 'PROBATION' | 'EXTENDED' | 'CONFIRMED';

/**
 * Derived server-side on every read, never stored as a status.
 *
 * That is why there is no `probationStatus` column to mirror here: a probation
 * that ended overnight reads as ended the moment the page opens, whether or
 * not the nightly tick has run.
 */
export interface ProbationView {
  state: ProbationState;
  /** The date in force — the extension when there is one. */
  endDate: string | null;
  /** The originally agreed end, present only when it was extended. */
  originalEndDate: string | null;
  /** Negative once the end date has passed. */
  daysRemaining: number | null;
  isOverdue: boolean;
}

export interface EmployeeDetail extends EmployeeListItem {
  personalEmail: string | null;
  dateOfBirth: string | null;
  gender: Gender | null;
  addressLine: string | null;
  city: string | null;
  country: string | null;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  managerId: string | null;
  shiftId: string | null;
  employmentTypeId: string | null;
  shift: Ref | null;
  employmentType: Ref | null;
  manager: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
  } | null;
  reports: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    designation: { title: string } | null;
  }[];
  /** Who to call if something happens at work. Visible to the employee and HR. */
  emergencyContacts: { id: string; name: string; relation: string; phone: string }[];
  user: {
    id: string;
    email: string;
    status: string;
    role: { id: string; code: RoleCodeInput } | null;
  } | null;
  bankDetail?: BankDetail | null;

  exitDate: string | null;
  /** Null means "inherit the company default"; `effectiveNoticeDays` resolves it. */
  noticePeriodDays: number | null;
  /** Remote days a week. Null is the company default; zero is "never". */
  remoteDaysPerWeek: number | null;
  probationMonths: number | null;
  probationEndDate: string | null;
  probationExtendedTo: string | null;
  confirmedOn: string | null;
  probation: ProbationView;
  effectiveNoticeDays: number;
}

export interface EmployeeOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
}

export function fullName(e: { firstName: string; lastName: string }): string {
  return `${e.firstName} ${e.lastName}`;
}

export function initials(e: { firstName: string; lastName: string }): string {
  return `${e.firstName[0] ?? ''}${e.lastName[0] ?? ''}`.toUpperCase();
}
