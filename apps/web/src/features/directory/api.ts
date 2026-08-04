import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

/**
 * The company directory. These types mirror the API's whitelist exactly — if a
 * field is not here, the server does not send it, and that is deliberate: the
 * HR record lives behind `employee.read` on a different endpoint.
 */
export interface DirectoryCard {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
  workEmail: string;
  department: { name: string } | null;
  designation: { title: string } | null;
  location: { name: string } | null;
}

export interface DirectoryProfile extends DirectoryCard {
  phone: string | null;
  manager: {
    id: string;
    firstName: string;
    lastName: string;
    employeeCode: string;
    avatarUrl: string | null;
  } | null;
}

export const directoryApi = {
  list: (params: ListRequest) => api<Paginated<DirectoryCard>>(`/directory${qs(params)}`),
  profile: (id: string) => api<DirectoryProfile>(`/directory/${id}`),
};

export const directoryKeys = {
  all: ['directory'] as const,
  list: (params: ListRequest) => ['directory', 'list', params] as const,
  profile: (id: string) => ['directory', 'profile', id] as const,
};

export const fullName = (p: { firstName: string; lastName: string }) =>
  `${p.firstName} ${p.lastName}`.trim();

export function initials(p: { firstName: string; lastName: string }): string {
  return `${p.firstName[0] ?? ''}${p.lastName[0] ?? ''}`.toUpperCase();
}
