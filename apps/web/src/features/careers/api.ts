import type { CareersApplyInput, PublicOpening } from '@hrms/shared';

/**
 * The public careers API.
 *
 * **Deliberately not `@/lib/api-client`.** That client attaches an access
 * token, refreshes on 401, redirects to sign-in when the refresh fails, and
 * carries credentials. Every one of those is wrong for a visitor with no
 * account: a 401 here should surface as an error, not bounce somebody who was
 * never signed in to a login page.
 *
 * So this is plain `fetch` with `credentials: 'omit'` — no cookies leave the
 * browser for these calls, which is also what keeps a job advert cacheable.
 */

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

async function publicFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { ...init, credentials: 'omit' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message ?? 'Something went wrong. Please try again.');
  }
  return response.json() as Promise<T>;
}

export const careersApi = {
  list: () => publicFetch<PublicOpening[]>('/careers'),
  get: (slug: string) => publicFetch<PublicOpening>(`/careers/${encodeURIComponent(slug)}`),

  /**
   * Multipart, because a CV rides along. `Content-Type` is left unset on
   * purpose — the browser has to add its own multipart boundary, and setting
   * it by hand produces a body the server cannot parse.
   */
  apply: (slug: string, input: CareersApplyInput, cv?: File) => {
    const form = new FormData();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined && value !== '') form.append(key, String(value));
    }
    if (cv) form.append('cv', cv);
    return publicFetch<{ received: true }>(`/careers/${encodeURIComponent(slug)}/apply`, {
      method: 'POST',
      body: form,
    });
  },
};
