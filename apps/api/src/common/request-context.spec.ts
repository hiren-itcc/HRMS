import { currentRequestContext, normaliseIp, runWithRequestContext } from './request-context';

describe('normaliseIp', () => {
  /*
   * The case that motivated this. Node reports an IPv4 client on a dual-stack
   * listener in mapped form, which is what CI's own request logs show
   * (`::ffff:127.0.0.1`) and what an audit table would otherwise display.
   */
  it('unwraps an IPv4-mapped IPv6 address', () => {
    expect(normaliseIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(normaliseIp('::FFFF:203.0.113.7')).toBe('203.0.113.7');
  });

  it('leaves a real IPv6 address alone', () => {
    expect(normaliseIp('2001:db8::1')).toBe('2001:db8::1');
    expect(normaliseIp('::1')).toBe('::1');
  });

  it('leaves a plain IPv4 address alone', () => {
    expect(normaliseIp('203.0.113.7')).toBe('203.0.113.7');
  });

  /* Absent is null, not the string "undefined" and not an empty column. */
  it.each([undefined, null, '', '   '])('reports %p as null', (raw) => {
    expect(normaliseIp(raw)).toBeNull();
  });

  /*
   * Not a validator. An address we cannot parse is still evidence, and a null
   * in its place destroys the only record of where a mutation came from.
   */
  it('keeps a value it does not recognise rather than dropping it', () => {
    expect(normaliseIp('not-an-address')).toBe('not-an-address');
    expect(normaliseIp('::ffff:not.an.ip')).toBe('::ffff:not.an.ip');
  });

  /*
   * The prefix is stripped on shape, not on validity. `999` is not a legal
   * octet, but unwrapping it loses nothing — the point is legibility, and an
   * address this broken is equally useless either way round.
   */
  it('unwraps on shape alone, without judging the octets', () => {
    expect(normaliseIp('::ffff:999.1.1.1')).toBe('999.1.1.1');
  });
});

describe('the request store', () => {
  it('has nothing outside a request', () => {
    expect(currentRequestContext()).toBeUndefined();
  });

  it('exposes the context to everything the request awaits', async () => {
    const seen = await runWithRequestContext({ ip: '203.0.113.7' }, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return currentRequestContext()?.ip;
    });

    expect(seen).toBe('203.0.113.7');
  });

  /*
   * The property the whole idea rests on. Two requests in flight at once must
   * not see each other's address, or the audit trail would be worse than
   * empty — it would be wrong, and confidently so.
   */
  it('keeps concurrent requests apart', async () => {
    const request = (ip: string, delay: number) =>
      runWithRequestContext({ ip }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        return currentRequestContext()?.ip;
      });

    // The slow one starts first and finishes last, so a shared variable would
    // hand it the fast one's address.
    const [slow, fast] = await Promise.all([request('10.0.0.1', 20), request('10.0.0.2', 1)]);

    expect({ slow, fast }).toEqual({ slow: '10.0.0.1', fast: '10.0.0.2' });
  });

  it('is empty again once the request ends', async () => {
    await runWithRequestContext({ ip: '10.0.0.1' }, async () => undefined);
    expect(currentRequestContext()).toBeUndefined();
  });
});
