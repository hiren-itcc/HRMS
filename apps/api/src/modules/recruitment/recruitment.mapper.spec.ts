import { mapCandidate, mapMaybeOffer, mapOffer, mapOpening, money } from './recruitment.mapper';

/**
 * A stand-in for Prisma's `Decimal`: an object whose `toString` is the number.
 * That is the shape `Number()` has to cope with, and the shape that would have
 * reached the browser as `"120000"` had nothing converted it.
 */
const decimal = (n: string) => ({ toString: () => n, valueOf: () => n });

describe('money out of recruitment', () => {
  it('turns a Decimal into a number', () => {
    expect(money(decimal('120000.50'))).toBe(120000.5);
  });

  /*
   * The whole reason this does not borrow payroll's `toMoney`, which returns 0.
   * An opening with no band advertised is not an opening that pays nothing, and
   * a screen showing ₹0 would be a lie rather than a blank.
   */
  it('leaves an unset amount null rather than making it zero', () => {
    expect(money(null)).toBeNull();
    expect(money(undefined)).toBeNull();
  });

  it('keeps everything else the row was carrying', () => {
    const mapped = mapOpening({
      id: 'op1',
      title: 'Software Engineer',
      minMonthlyCtc: decimal('80000'),
      maxMonthlyCtc: null,
      department: { name: 'Engineering' },
    });

    expect(mapped).toMatchObject({
      id: 'op1',
      title: 'Software Engineer',
      minMonthlyCtc: 80000,
      maxMonthlyCtc: null,
      department: { name: 'Engineering' },
    });
  });

  it('converts a candidate expectation and an offer', () => {
    expect(mapCandidate({ expectedMonthlyCtc: decimal('95000') }).expectedMonthlyCtc).toBe(95000);
    expect(mapOffer({ monthlyCtc: decimal('110000') }).monthlyCtc).toBe(110000);
  });

  /* A candidate at the screening stage has no offer, and null is not a row. */
  it('passes a missing offer through untouched', () => {
    expect(mapMaybeOffer(null)).toBeNull();
  });
});
