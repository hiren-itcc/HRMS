import {
  attritionRate,
  monthKeyOf,
  monthKeysBetween,
  percentage,
  tenureBucket,
  tenureMonths,
} from './reports.util';

describe('month keys', () => {
  it('derives a YYYY-MM key', () => {
    expect(monthKeyOf(new Date('2026-08-15T00:00:00.000Z'))).toBe('2026-08');
  });

  it('spans a range inclusively', () => {
    expect(monthKeysBetween('2026-06-01', '2026-09-30')).toEqual([
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  it('crosses a year boundary correctly', () => {
    expect(monthKeysBetween('2026-11-01', '2027-02-28')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('returns a single month when from and to share one', () => {
    expect(monthKeysBetween('2026-08-01', '2026-08-31')).toEqual(['2026-08']);
  });
});

describe('attritionRate', () => {
  it('is a percentage of average headcount', () => {
    // 5 exits, headcount 100 → 90, average 95 → 5.3%
    expect(attritionRate(5, 100, 90)).toBe(5.3);
  });

  it('returns 0 rather than NaN when there is no headcount', () => {
    expect(attritionRate(0, 0, 0)).toBe(0);
  });

  it('returns 0 rather than Infinity when exits exist but headcount is 0', () => {
    expect(attritionRate(3, 0, 0)).toBe(0);
  });

  it('handles a fully departed workforce without breaking', () => {
    expect(attritionRate(10, 10, 0)).toBe(200);
  });
});

describe('tenure', () => {
  const asOf = new Date('2026-08-15T00:00:00.000Z');

  it('counts whole months only', () => {
    expect(tenureMonths(new Date('2026-07-20T00:00:00.000Z'), asOf)).toBe(0);
    expect(tenureMonths(new Date('2026-07-15T00:00:00.000Z'), asOf)).toBe(1);
  });

  it('never returns negative tenure for a future joiner', () => {
    expect(tenureMonths(new Date('2026-12-01T00:00:00.000Z'), asOf)).toBe(0);
  });

  it('buckets at the boundaries', () => {
    expect(tenureBucket(0)).toBe('< 6 months');
    expect(tenureBucket(5)).toBe('< 6 months');
    expect(tenureBucket(6)).toBe('6–12 months');
    expect(tenureBucket(12)).toBe('1–2 years');
    expect(tenureBucket(24)).toBe('2–5 years');
    expect(tenureBucket(60)).toBe('5+ years');
    expect(tenureBucket(500)).toBe('5+ years');
  });
});

describe('percentage', () => {
  it('rounds to one decimal', () => {
    expect(percentage(1, 3)).toBe(33.3);
  });

  it('returns 0 for an empty denominator', () => {
    expect(percentage(5, 0)).toBe(0);
  });
});
