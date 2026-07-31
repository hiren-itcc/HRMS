import type { ApiErrorBody } from '@hrms/types';

/**
 * Single typed fetch wrapper (docs/09-nextjs-architecture.md).
 * - attaches the in-memory access token (never persisted to storage)
 * - sends credentials so the httpOnly refresh cookie flows to /auth routes
 * - on 401, refreshes once (single-flight) and replays the request
 *
 * Feature `api.ts` files are the only intended importers.
 */

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
  }

  get status(): number {
    return this.body.statusCode;
  }
}

async function tryRefresh(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = (await res.json()) as { accessToken: string };
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

export async function api<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !isRetry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return api<T>(path, init, true);
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(
      body ?? { statusCode: res.status, error: res.statusText, message: 'Request failed' },
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
