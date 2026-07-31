/**
 * Non-httpOnly marker cookie read by src/proxy.ts for fast, UX-only
 * redirects. Carries no secret — the real session is the httpOnly refresh
 * cookie owned by the API.
 */
const MARKER = 'hrms_session';
const YEAR_S = 60 * 60 * 24 * 365;

export function setSessionMarker(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: CookieStore API is not yet available in all supported browsers
  document.cookie = `${MARKER}=1; path=/; max-age=${YEAR_S}; samesite=lax`;
}

export function clearSessionMarker(): void {
  // biome-ignore lint/suspicious/noDocumentCookie: CookieStore API is not yet available in all supported browsers
  document.cookie = `${MARKER}=; path=/; max-age=0`;
}
