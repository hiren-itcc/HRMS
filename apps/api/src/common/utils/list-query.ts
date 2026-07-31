import type { PaginationQuery } from '@hrms/shared';
import type { Paginated } from '@hrms/types';

/**
 * Translates the standard list query (docs/03-api-structure.md §conventions)
 * into Prisma args. `sortable` whitelists sort fields — a client-supplied
 * sort key never reaches Prisma unchecked.
 */
export function buildListArgs(
  query: PaginationQuery,
  sortable: readonly string[],
  defaultSort: string,
): { skip: number; take: number; orderBy: Record<string, 'asc' | 'desc'> } {
  const sort = query.sort && sortable.includes(query.sort) ? query.sort : defaultSort;
  return {
    skip: (query.page - 1) * query.limit,
    take: query.limit,
    orderBy: { [sort]: query.order },
  };
}

export function toPaginated<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { data, meta: { page: query.page, limit: query.limit, total } };
}

/** Case-insensitive `contains` filter across several fields, or {} when no search. */
export function searchWhere(search: string | undefined, fields: readonly string[]) {
  if (!search) return {};
  return {
    OR: fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' as const } })),
  };
}
