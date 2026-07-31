import { buildListArgs, searchWhere, toPaginated } from './list-query';

const query = { page: 2, limit: 20, order: 'desc' as const, sort: undefined, search: undefined };

describe('buildListArgs', () => {
  it('paginates and applies the default sort', () => {
    expect(buildListArgs(query, ['name'], 'name')).toEqual({
      skip: 20,
      take: 20,
      orderBy: { name: 'desc' },
    });
  });

  it('accepts a whitelisted sort field', () => {
    expect(buildListArgs({ ...query, sort: 'code' }, ['name', 'code'], 'name').orderBy).toEqual({
      code: 'desc',
    });
  });

  it('falls back to the default for a non-whitelisted sort field', () => {
    const args = buildListArgs({ ...query, sort: 'passwordHash' }, ['name'], 'name');
    expect(args.orderBy).toEqual({ name: 'desc' });
  });
});

describe('searchWhere', () => {
  it('returns empty object without a search term', () => {
    expect(searchWhere(undefined, ['name'])).toEqual({});
  });

  it('builds a case-insensitive OR across fields', () => {
    expect(searchWhere('hr', ['name', 'code'])).toEqual({
      OR: [
        { name: { contains: 'hr', mode: 'insensitive' } },
        { code: { contains: 'hr', mode: 'insensitive' } },
      ],
    });
  });
});

describe('toPaginated', () => {
  it('wraps rows in the standard envelope', () => {
    expect(toPaginated([1, 2], 42, query)).toEqual({
      data: [1, 2],
      meta: { page: 2, limit: 20, total: 42 },
    });
  });
});
