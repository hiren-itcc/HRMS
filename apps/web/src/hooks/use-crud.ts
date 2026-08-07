'use client';

import {
  keepPreviousData,
  type QueryKey,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import type { CrudApi, ListRequest } from '@/lib/crud';

/**
 * What to show the user when a request fails.
 *
 * An `ApiError` carries the API's own message, which is written for the person
 * reading it ("An employee with that code already exists"). Anything else is a
 * network or parse failure, whose message is written for us ("Failed to
 * fetch"), so the caller's fallback is shown instead.
 */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function useCrudList<TRow>(
  key: string,
  crud: Pick<CrudApi<TRow, never, never>, 'list'>,
  params: ListRequest,
) {
  return useQuery({
    queryKey: [key, 'list', params],
    queryFn: () => crud.list(params),
    placeholderData: keepPreviousData,
  });
}

interface ApiMutationOptions<TData, TVars> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /**
   * Keys to invalidate on success. Prefixes, per doc 09 — `['employees']`
   * covers `['employees', 'options']` and `['employees', 'detail', id]` too.
   */
  invalidate?: QueryKey[];
  /** Omit for a silent success. A function receives the result, for counts and names. */
  success?: string | ((data: TData, vars: TVars) => string);
  /** Shown only when the failure is not an `ApiError` carrying its own message. */
  error?: string;
  /** Anything else the caller needs — closing a dialog, navigating, resetting a form. */
  onSuccess?: (data: TData, vars: TVars) => void;
  /** Takes over failure handling entirely. For errors that are not just a toast. */
  onError?: (err: unknown, vars: TVars) => void;
}

/**
 * A mutation that invalidates, reports and fails the way the rest of the app does.
 *
 * This exists because the same eight lines were written out at 33 call sites,
 * and the ones that drifted drifted quietly: the payroll module never checked
 * `instanceof ApiError`, so a dropped connection there showed the user "Failed
 * to fetch" where every other screen showed a sentence.
 *
 * Deliberately thin. Optimistic updates, `setQueryData` and conditional
 * invalidation keep plain `useMutation` — absorbing the boilerplate is the
 * point, not owning every mutation.
 */
export function useApiMutation<TData, TVars = void>({
  mutationFn,
  invalidate,
  success,
  error,
  onSuccess,
  onError,
}: ApiMutationOptions<TData, TVars>) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn,
    onSuccess: (data, vars) => {
      for (const queryKey of invalidate ?? []) queryClient.invalidateQueries({ queryKey });
      const message = typeof success === 'function' ? success(data, vars) : success;
      if (message) toast.success(message);
      onSuccess?.(data, vars);
    },
    onError: (err, vars) => {
      if (onError) {
        onError(err, vars);
        return;
      }
      toast.error(errorMessage(err, error));
    },
  });
}

export function useCrudMutations<TRow, TCreate, TUpdate>(
  key: string,
  crud: CrudApi<TRow, TCreate, TUpdate>,
  label: string,
) {
  const invalidate = [[key]];

  return {
    create: useApiMutation({
      mutationFn: (input: TCreate) => crud.create(input),
      invalidate,
      success: `${label} created`,
    }),
    update: useApiMutation({
      mutationFn: ({ id, input }: { id: string; input: TUpdate }) => crud.update(id, input),
      invalidate,
      success: `${label} updated`,
    }),
    remove: useApiMutation({
      mutationFn: (id: string) => crud.remove(id),
      invalidate,
      success: `${label} deleted`,
    }),
  };
}

/** What every select in the app wants, whatever the endpoint calls its columns. */
export interface Option {
  id: string;
  label: string;
}

/**
 * A dropdown's contents.
 *
 * `options` stays `undefined` until the request settles, rather than becoming
 * `[]`, because a select has to tell "still loading" from "there are none" —
 * an empty list that means the former reads as a misconfigured organization.
 * That is the distinction `FormSelect`'s `busy` prop is built around.
 *
 * `toLabel` is required because the API is not consistent about what the
 * human-readable column is called: departments have `name`, designations have
 * `title`. Naming it at the call site is shorter than normalising six
 * endpoints, and it is checked.
 */
export function useOptions<T extends { id: string }>(
  key: string | readonly unknown[],
  fetcher: () => Promise<T[]>,
  toLabel: (row: T) => string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const query = useQuery({
    // A prefix, not just a name: leave types live at `['leave', 'types',
    // 'options']` so that invalidating `['leave']` after an edit reaches them.
    queryKey: [...(typeof key === 'string' ? [key] : key), 'options'],
    queryFn: fetcher,
    // Options change when somebody edits the organization, which is rare.
    staleTime: 60_000,
    enabled,
  });

  return {
    ...query,
    options: query.data?.map((row): Option => ({ id: row.id, label: toLabel(row) })),
  };
}
