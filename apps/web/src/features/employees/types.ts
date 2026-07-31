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
  user: { id: string; email: string; status: string } | null;
  bankDetail?: BankDetail | null;
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
