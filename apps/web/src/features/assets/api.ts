import type {
  AssetCategoryInput,
  AssetConditionCode,
  AssetCreateInput,
  AssetIssueInput,
  AssetReturnInput,
  AssetStatusChangeInput,
  AssetStatusCode,
  AssetUpdateInput,
} from '@hrms/shared';
import type { Paginated } from '@hrms/types';
import type { ActivityEntry } from '@/features/resignations/types';
import { api } from '@/lib/api-client';
import { type ListRequest, qs } from '@/lib/crud';

export interface AssetHolder {
  id: string;
  firstName: string;
  lastName: string;
  employeeCode: string;
  avatarUrl: string | null;
}

export interface AssetAssignment {
  id: string;
  employeeId: string;
  issuedOn: string;
  conditionOut: AssetConditionCode;
  returnedOn: string | null;
  conditionIn: AssetConditionCode | null;
  notes: string | null;
  employee?: AssetHolder;
}

export interface Asset {
  id: string;
  categoryId: string;
  assetTag: string;
  name: string;
  serialNumber: string | null;
  make: string | null;
  model: string | null;
  status: AssetStatusCode;
  condition: AssetConditionCode;
  purchaseDate: string | null;
  purchaseCost: number | null;
  warrantyEnd: string | null;
  vendor: string | null;
  locationId: string | null;
  notes: string | null;
  category: { id: string; name: string };
  location: { id: string; name: string } | null;
  /** On a list read this is the open assignment only, so at most one. */
  assignments: AssetAssignment[];
}

/** What one person is holding — an open assignment with its asset attached. */
export interface HeldAsset {
  id: string;
  issuedOn: string;
  conditionOut: AssetConditionCode;
  notes: string | null;
  asset: Asset & { category: { id: string; name: string } };
}

export interface AssetCategory {
  id: string;
  name: string;
  _count?: { assets: number };
}

/** The open assignment, if there is one. Reads better than `[0]` at each site. */
export function holderOf(asset: Asset): AssetHolder | null {
  return asset.assignments.find((a) => a.returnedOn === null)?.employee ?? null;
}

export const assetKeys = {
  all: () => ['assets'] as const,
  list: (params: ListRequest) => ['assets', 'list', params] as const,
  detail: (id: string) => ['assets', 'detail', id] as const,
  activity: (id: string) => ['assets', 'detail', id, 'activity'] as const,
  categories: () => ['assets', 'categories'] as const,
  mine: () => ['assets', 'mine'] as const,
  heldBy: (employeeId: string) => ['assets', 'held-by', employeeId] as const,
};

export const assetsApi = {
  list: (params: ListRequest) => api<Paginated<Asset>>(`/assets${qs(params)}`),
  detail: (id: string) => api<Asset>(`/assets/${id}`),
  activity: (id: string) => api<ActivityEntry[]>(`/assets/${id}/activity`),
  mine: () => api<HeldAsset[]>('/assets/me'),
  heldBy: (employeeId: string) => api<HeldAsset[]>(`/assets/employee/${employeeId}`),

  create: (input: AssetCreateInput) =>
    api<Asset>('/assets', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: AssetUpdateInput) =>
    api<Asset>(`/assets/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
  remove: (id: string) => api<{ id: string }>(`/assets/${id}`, { method: 'DELETE' }),

  issue: (id: string, input: AssetIssueInput) =>
    api<Asset>(`/assets/${id}/issue`, { method: 'POST', body: JSON.stringify(input) }),
  return: (id: string, input: AssetReturnInput) =>
    api<Asset>(`/assets/${id}/return`, { method: 'POST', body: JSON.stringify(input) }),
  setStatus: (id: string, input: AssetStatusChangeInput) =>
    api<Asset>(`/assets/${id}/status`, { method: 'POST', body: JSON.stringify(input) }),

  categories: () => api<AssetCategory[]>('/assets/categories'),
  createCategory: (input: AssetCategoryInput) =>
    api<AssetCategory>('/assets/categories', { method: 'POST', body: JSON.stringify(input) }),
  updateCategory: (id: string, input: AssetCategoryInput) =>
    api<AssetCategory>(`/assets/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  removeCategory: (id: string) =>
    api<{ id: string }>(`/assets/categories/${id}`, { method: 'DELETE' }),
};
