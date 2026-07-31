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

/** Multipart upload via XHR — the only way to get real progress events. */
export function uploadFile<T>(
  path: string,
  formData: FormData,
  onProgress: (percent: number) => void,
  isRetry = false,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${path}`);
    xhr.withCredentials = true;
    if (accessToken) xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () =>
      reject(new ApiError({ statusCode: 0, error: 'Network', message: 'Upload failed' }));
    xhr.onload = async () => {
      if (xhr.status === 401 && !isRetry && (await tryRefresh())) {
        resolve(await uploadFile<T>(path, formData, onProgress, true));
        return;
      }
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else
        reject(
          new ApiError(
            (body as ApiErrorBody) ?? {
              statusCode: xhr.status,
              error: 'UploadError',
              message: 'Upload failed',
            },
          ),
        );
    };
    xhr.send(formData);
  });
}

/** Authenticated binary fetch (preview/download blobs). */
export async function fetchBlob(path: string, isRetry = false): Promise<Blob> {
  const headers = new Headers();
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const res = await fetch(`${BASE_URL}${path}`, { headers, credentials: 'include' });
  if (res.status === 401 && !isRetry && (await tryRefresh())) return fetchBlob(path, true);
  if (!res.ok) {
    throw new ApiError({ statusCode: res.status, error: res.statusText, message: 'Fetch failed' });
  }
  return res.blob();
}
