import type { Paginated } from '@hrms/types';
import { api } from '@/lib/api-client';

/**
 * Query-string parameters for a list endpoint.
 *
 * Deliberately loose: page and limit arrive as numbers, everything else as
 * strings, and `undefined` means "the caller did not ask", which is not the
 * same as asking for an empty value.
 */
export type ListRequest = Record<string, string | number | undefined>;

/**
 * Build a query string, dropping anything the caller left unanswered.
 *
 * The empty-string check matters as much as the undefined one: a cleared
 * search box gives `''`, and `?search=` asks the API to match the empty
 * string rather than to stop filtering.
 */
export function qs(params: ListRequest): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

/** The four verbs every list-backed resource in the app supports. */
export interface CrudApi<TRow, TCreate, TUpdate> {
  list: (params: ListRequest) => Promise<Paginated<TRow>>;
  create: (input: TCreate) => Promise<TRow>;
  update: (id: string, input: TUpdate) => Promise<TRow>;
  remove: (id: string) => Promise<void>;
}

/**
 * A typed CRUD client for a REST collection.
 *
 * Spread it to add resource-specific calls:
 * `{ ...crudApi(base), options: () => api<Option[]>(`${base}/options`) }`.
 */
export function crudApi<TRow, TCreate, TUpdate>(base: string): CrudApi<TRow, TCreate, TUpdate> {
  return {
    list: (params) => api<Paginated<TRow>>(`${base}${qs(params)}`),
    create: (input) => api<TRow>(base, { method: 'POST', body: JSON.stringify(input) }),
    update: (id, input) =>
      api<TRow>(`${base}/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id) => api<void>(`${base}/${id}`, { method: 'DELETE' }),
  };
}
