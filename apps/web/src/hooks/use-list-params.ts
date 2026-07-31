'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';

/**
 * List state (search/sort/page/filters) lives in the URL — every table view
 * is deep-linkable and browser back works (docs/05 §UX rules).
 */
export function useListParams(defaultSort: string) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const set = useCallback(
    (patch: Record<string, string | number | undefined>) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(`${pathname}${next.size ? `?${next}` : ''}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  // Memoized so callbacks keep a stable identity across re-renders —
  // CrudShell's debounce effect depends on it.
  return useMemo(() => {
    const sort = searchParams.get('sort') ?? defaultSort;
    const order = (searchParams.get('order') === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc';
    return {
      page: Math.max(1, Number(searchParams.get('page')) || 1),
      search: searchParams.get('q') ?? '',
      sort,
      order,
      get: (key: string) => searchParams.get(key) ?? undefined,
      setSearch: (q: string) => set({ q, page: undefined }),
      setPage: (page: number) => set({ page: page > 1 ? page : undefined }),
      /** Toggles asc → desc → asc when re-clicking the active column. */
      toggleSort: (key: string) =>
        set({
          sort: key,
          order: sort === key && order === 'asc' ? 'desc' : 'asc',
          page: undefined,
        }),
      setFilter: (key: string, value: string | undefined) => set({ [key]: value, page: undefined }),
    };
  }, [searchParams, defaultSort, set]);
}

export type ListParams = ReturnType<typeof useListParams>;
