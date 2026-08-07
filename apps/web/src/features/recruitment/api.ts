import type {
  ApplicationCreateInput,
  ApplicationStageChangeInput,
  ApplicationStageCode,
  CandidateCreateInput,
  CandidateUpdateInput,
  HireInput,
  InterviewCreateInput,
  InterviewFeedbackInput,
  InterviewModeCode,
  InterviewRecommendationCode,
  OfferCreateInput,
  OfferRespondInput,
  OfferStatusCode,
  OpeningCreateInput,
  OpeningStatusChangeInput,
  OpeningStatusCode,
  RejectionReasonCode,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

/**
 * Recruitment.
 *
 * Money arrives as a number, not a string: the API converts its Decimals in
 * `recruitment.mapper.ts` before they reach the wire, the way payroll does.
 * `null` means no figure was given — an opening with no band advertised is not
 * an opening that pays nothing.
 */

interface Named {
  id: string;
  name: string;
}

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

export const fullName = (p: PersonRef) => `${p.firstName} ${p.lastName}`;

export interface JobOpening {
  id: string;
  title: string;
  status: OpeningStatusCode;
  headcount: number;
  description: string | null;
  minMonthlyCtc: number | null;
  maxMonthlyCtc: number | null;
  departmentId: string | null;
  designationId: string | null;
  locationId: string | null;
  employmentTypeId: string | null;
  hiringManagerId: string | null;
  openedOn: string | null;
  closedOn: string | null;
  createdAt: string;
  department: Named | null;
  designation: { id: string; title: string } | null;
  location: Named | null;
  employmentType: Named | null;
  hiringManager: PersonRef | null;
}

/** The list adds the number it is actually read for: who is live in this pipeline. */
export interface OpeningRow extends JobOpening {
  liveApplications: number;
}

export interface Candidate {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  currentEmployer: string | null;
  currentTitle: string | null;
  noticePeriodDays: number | null;
  expectedMonthlyCtc: number | null;
  source: string | null;
  referrerId: string | null;
  notes: string | null;
  createdAt: string;
}

export interface CandidateRow extends Candidate {
  _count: { applications: number };
}

export interface Interview {
  id: string;
  applicationId: string;
  scheduledFor: string;
  durationMinutes: number;
  mode: InterviewModeCode;
  round: string | null;
  recommendation: InterviewRecommendationCode | null;
  notes: string | null;
  /** The freeze. Set means the feedback is in and cannot be rewritten. */
  submittedAt: string | null;
  cancelledAt: string | null;
  interviewer: PersonRef | null;
}

export interface Offer {
  id: string;
  applicationId: string;
  status: OfferStatusCode;
  monthlyCtc: number;
  joinDate: string;
  expiresOn: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  notes: string | null;
  hiredEmployeeId: string | null;
}

export interface Application {
  id: string;
  candidateId: string;
  openingId: string;
  stage: ApplicationStageCode;
  appliedOn: string;
  rejectionReason: RejectionReasonCode | null;
  rejectionNote: string | null;
  decidedAt: string | null;
}

/** One opening with its whole pipeline — the board is drawn from this. */
export interface OpeningDetail extends JobOpening {
  applications: (Application & {
    candidate: Candidate;
    offer: Pick<Offer, 'id' | 'status' | 'monthlyCtc'> | null;
    _count: { interviews: number };
  })[];
}

export interface CandidateDetail extends Candidate {
  referrer: PersonRef | null;
  applications: (Application & {
    opening: { id: string; title: string; status: OpeningStatusCode };
    offer: Offer | null;
    interviews: Interview[];
  })[];
}

export interface OfferDetail extends Offer {
  application: Application & {
    candidate: Candidate;
    opening: { id: string; title: string };
  };
  designation: { id: string; title: string } | null;
  department: Named | null;
  location: Named | null;
  employmentType: Named | null;
  hiredEmployee: { id: string; employeeCode: string } | null;
}

/** What a hire produced, including whether the invite actually went. */
export interface HireResult {
  employee: { id: string; employeeCode: string };
  inviteSent: boolean;
  inviteError: string | null;
}

export const recruitmentKeys = {
  all: () => ['recruitment'] as const,
  openings: (params: ListRequest) => ['recruitment', 'openings', params] as const,
  opening: (id: string) => ['recruitment', 'opening', id] as const,
  candidates: (params: ListRequest) => ['recruitment', 'candidates', params] as const,
  candidate: (id: string) => ['recruitment', 'candidate', id] as const,
  offer: (id: string) => ['recruitment', 'offer', id] as const,
};

export const recruitmentApi = {
  openings: (params: ListRequest) => api<Paginated<OpeningRow>>(`/recruitment${qs(params)}`),
  opening: (id: string) => api<OpeningDetail>(`/recruitment/${id}`),
  createOpening: (input: OpeningCreateInput) =>
    api<JobOpening>('/recruitment', { method: 'POST', body: JSON.stringify(input) }),
  updateOpening: (id: string, input: OpeningCreateInput) =>
    api<JobOpening>(`/recruitment/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  setOpeningStatus: (id: string, input: OpeningStatusChangeInput) =>
    api<JobOpening>(`/recruitment/${id}/status`, { method: 'PATCH', body: JSON.stringify(input) }),

  candidates: (params: ListRequest) =>
    api<Paginated<CandidateRow>>(`/recruitment/candidates${qs(params)}`),
  candidate: (id: string) => api<CandidateDetail>(`/recruitment/candidates/${id}`),
  createCandidate: (input: CandidateCreateInput) =>
    api<Candidate>('/recruitment/candidates', { method: 'POST', body: JSON.stringify(input) }),
  updateCandidate: (id: string, input: CandidateUpdateInput) =>
    api<Candidate>(`/recruitment/candidates/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  apply: (input: ApplicationCreateInput) =>
    api<Application>('/recruitment/applications', { method: 'POST', body: JSON.stringify(input) }),
  moveStage: (id: string, input: ApplicationStageChangeInput) =>
    api<Application>(`/recruitment/applications/${id}/stage`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  scheduleInterview: (input: InterviewCreateInput) =>
    api<Interview>('/recruitment/interviews', { method: 'POST', body: JSON.stringify(input) }),
  submitFeedback: (id: string, input: InterviewFeedbackInput) =>
    api<Interview>(`/recruitment/interviews/${id}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  createOffer: (input: OfferCreateInput) =>
    api<Offer>('/recruitment/offers', { method: 'POST', body: JSON.stringify(input) }),
  offer: (id: string) => api<OfferDetail>(`/recruitment/offers/${id}`),
  sendOffer: (id: string) => api<Offer>(`/recruitment/offers/${id}/send`, { method: 'PATCH' }),
  respondToOffer: (id: string, input: OfferRespondInput) =>
    api<Offer>(`/recruitment/offers/${id}/respond`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  hire: (id: string, input: HireInput) =>
    api<HireResult>(`/recruitment/offers/${id}/hire`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
