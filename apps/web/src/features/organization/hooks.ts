'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api-client';
import type { CrudApi, ListRequest } from './api';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong. Try again.';
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

export function useCrudMutations<TRow, TCreate, TUpdate>(
  key: string,
  crud: CrudApi<TRow, TCreate, TUpdate>,
  label: string,
) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: [key] });

  const create = useMutation({
    mutationFn: (input: TCreate) => crud.create(input),
    onSuccess: () => {
      invalidate();
      toast.success(`${label} created`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: TUpdate }) => crud.update(id, input),
    onSuccess: () => {
      invalidate();
      toast.success(`${label} updated`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => crud.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success(`${label} deleted`);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  return { create, update, remove };
}

export function useOptions<T>(key: string, fetcher: () => Promise<T>) {
  return useQuery({ queryKey: [key, 'options'], queryFn: fetcher, staleTime: 60_000 });
}
