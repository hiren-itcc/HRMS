import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setAccessToken } from './api-client';

/**
 * The single-flight refresh is the most consequential logic in the web app and
 * had no tests at all. Every failure mode here looks the same from the outside —
 * the user is signed out — so the interesting part is *which* one happened.
 */

const original = globalThis.fetch;

/** A fetch double that answers by URL+method, recording every call. */
function stubFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as unknown as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => setAccessToken(null));
afterEach(() => {
  globalThis.fetch = original;
});

describe('api()', () => {
  it('sends the in-memory access token as a bearer header', async () => {
    setAccessToken('tok-1');
    const calls = stubFetch(() => json({ ok: true }));

    await api('/employees');

    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('always sends credentials, or the refresh cookie never travels', async () => {
    const calls = stubFetch(() => json({ ok: true }));
    await api('/employees');
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('sets JSON content-type only when there is a body', async () => {
    const calls = stubFetch(() => json({ ok: true }));

    await api('/employees');
    await api('/employees', { method: 'POST', body: '{}' });

    expect(new Headers(calls[0]?.init.headers).get('Content-Type')).toBeNull();
    expect(new Headers(calls[1]?.init.headers).get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for 204 rather than choking on an empty body', async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    await expect(api('/documents/x')).resolves.toBeUndefined();
  });

  /*
   * A Nest handler that returns null sends **200** with nothing in it, not 204
   * — which is what `GET /offboardings/:id/interview` does for an exit nobody
   * has held the conversation for yet. `res.json()` on that throws "Unexpected
   * end of JSON input", so the Exit interview card showed its error state for
   * every offboarding without one. The endpoint's own type said
   * `ExitInterview | null`; the client could not produce the null.
   */
  it('reads an empty 200 as null — the answer "there is nothing here yet"', async () => {
    stubFetch(() => new Response(null, { status: 200 }));
    await expect(api('/offboardings/o1/interview')).resolves.toBeNull();
  });

  it('throws ApiError carrying the server message, not a generic failure', async () => {
    stubFetch(() =>
      json({ statusCode: 400, error: 'Bad Request', message: 'Exit date is required' }, 400),
    );

    await expect(api('/employees/x/offboard')).rejects.toMatchObject({
      status: 400,
      message: 'Exit date is required',
    });
    expect(await api('/x').catch((e) => e instanceof ApiError)).toBe(true);
  });

  it('falls back to a usable error when the body is not JSON', async () => {
    // A 502 from a proxy is HTML. Without this the client throws a parse error
    // and the user sees nothing about what actually happened.
    stubFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(api('/employees')).rejects.toMatchObject({ status: 502 });
  });
});

describe('api() refresh on 401', () => {
  it('refreshes once, then replays the original request with the new token', async () => {
    setAccessToken('stale');
    let refreshed = false;
    const calls = stubFetch((url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshed = true;
        return json({ accessToken: 'fresh' });
      }
      return refreshed ? json({ ok: true }) : json({ statusCode: 401 }, 401);
    });

    await expect(api('/employees')).resolves.toEqual({ ok: true });

    expect(calls.map((c) => c.url)).toEqual([
      expect.stringContaining('/employees'),
      expect.stringContaining('/auth/refresh'),
      expect.stringContaining('/employees'),
    ]);
    // The replay must carry the NEW token; carrying the stale one loops.
    expect(new Headers(calls[2]?.init.headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('gives up after one retry instead of looping forever', async () => {
    setAccessToken('stale');
    const calls = stubFetch((url) =>
      url.endsWith('/auth/refresh')
        ? json({ accessToken: 'fresh' })
        : json({ statusCode: 401 }, 401),
    );

    await expect(api('/employees')).rejects.toMatchObject({ status: 401 });
    // request, refresh, replay — and stop.
    expect(calls).toHaveLength(3);
  });

  it('does not try to refresh a failed /auth/ call', async () => {
    // Refreshing because login returned 401 would turn a wrong password into a
    // second request and a confusing error.
    const calls = stubFetch(() => json({ statusCode: 401, message: 'Invalid credentials' }, 401));

    await expect(api('/auth/login', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 401,
    });
    expect(calls).toHaveLength(1);
  });

  it('refreshes ONCE for concurrent 401s — the whole point of single-flight', async () => {
    setAccessToken('stale');
    let refreshCount = 0;
    let refreshed = false;
    stubFetch(async (url) => {
      if (url.endsWith('/auth/refresh')) {
        refreshCount += 1;
        // Let other in-flight requests reach the same await before resolving.
        await new Promise((r) => setTimeout(r, 10));
        refreshed = true;
        return json({ accessToken: 'fresh' });
      }
      return refreshed ? json({ ok: true }) : json({ statusCode: 401 }, 401);
    });

    await Promise.all([api('/employees'), api('/leave/requests'), api('/attendance/me')]);

    // Three simultaneous 401s must produce one refresh. Three would rotate the
    // token three times and reuse-detection would revoke the whole chain.
    expect(refreshCount).toBe(1);
  });

  it('surfaces the original 401 when the refresh itself fails', async () => {
    setAccessToken('stale');
    stubFetch((url) =>
      url.endsWith('/auth/refresh') ? json({}, 401) : json({ statusCode: 401 }, 401),
    );

    await expect(api('/employees')).rejects.toMatchObject({ status: 401 });
  });

  it('survives a refresh that throws rather than returning a response', async () => {
    setAccessToken('stale');
    stubFetch((url) => {
      if (url.endsWith('/auth/refresh')) throw new TypeError('network down');
      return json({ statusCode: 401 }, 401);
    });

    // A dropped connection during refresh must still reject the caller cleanly.
    await expect(api('/employees')).rejects.toMatchObject({ status: 401 });
  });
});
