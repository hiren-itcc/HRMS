import type {
  OffboardingStatusCode,
  ResignationReasonCode,
  ResignationStatusCode,
} from '@hrms/shared';

export interface ResignationEmployee {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  avatarUrl: string | null;
  workEmail: string;
  managerId: string | null;
  joinDate: string;
  department: { id: string; name: string } | null;
  designation: { id: string; title: string } | null;
}

export interface Resignation {
  id: string;
  employeeId: string;
  status: ResignationStatusCode;
  reason: ResignationReasonCode;
  remarks: string | null;

  requestedLastWorkingDate: string;
  approvedLastWorkingDate: string | null;
  /** The notice in force when it was filed, frozen at that moment. */
  noticeDays: number;
  earliestLastWorkingDate: string;

  submittedAt: string;
  routedManagerId: string | null;
  managerDecidedAt: string | null;
  managerDecidedById: string | null;
  managerRemarks: string | null;
  hrDecidedAt: string | null;
  hrDecidedById: string | null;
  hrRemarks: string | null;
  withdrawnAt: string | null;

  employee: ResignationEmployee;
  offboarding: {
    id: string;
    status: OffboardingStatusCode;
    lastWorkingDate: string;
  } | null;

  /* Derived server-side, so no screen recomputes them from the dates. */
  /** Asked to leave sooner than the notice period allows. */
  isShortNotice: boolean;
  /** The approved date once there is one, otherwise the requested one. */
  lastWorkingDate: string;
  daysUntilLastWorkingDate: number;
  awaitingDesk: 'MANAGER' | 'HR' | null;
}

/** What the form needs before it can offer a sensible default, or say why not. */
export interface ResignationEligibility {
  noticeDays: number;
  earliestLastWorkingDate: string;
  today: string;
  canSubmit: boolean;
  blockedReason: string | null;
  current: Resignation | null;
}

export interface ActivityEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
  /** Null for a system action, and for a user deleted since. */
  actor: { id: string; email: string; name: string | null } | null;
}
