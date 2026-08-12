import { BRAND_PATH } from '@/components/brand-mark';

/** The three `--brand-ramp-*` stops, already resolved to colours an SVG can render anywhere. */
export type FaviconStops = readonly [string, string, string];

/**
 * Builds the runtime favicon markup.
 *
 * Same shell as `app/icon.svg` — a 32×32 rounded tile, the glyph in white,
 * `fill-rule="evenodd"` so the briefcase handle is a real hole rather than an
 * overpaint — but the gradient stops are whatever the caller resolved for the
 * *current* theme, and the path comes from `BRAND_PATH` rather than a second
 * copy of it. That import is the point: this can no longer drift from the
 * in-app mark the way the old hand-kept `icon.svg` could have.
 *
 * Pure on purpose — no DOM, no `window`, nothing that needs a browser — so it
 * can be unit tested directly. `favicon.tsx` is the thin effect around it
 * that resolves live colours and calls this.
 */
export function buildFaviconSvg([stop1, stop2, stop3]: FaviconStops): string {
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">' +
    '<defs><linearGradient id="brand" x1="0" y1="0" x2="1" y2="1">' +
    `<stop offset="0%" stop-color="${stop1}" />` +
    `<stop offset="55%" stop-color="${stop2}" />` +
    `<stop offset="100%" stop-color="${stop3}" />` +
    '</linearGradient></defs>' +
    '<rect width="32" height="32" rx="7" fill="url(#brand)" />' +
    '<g transform="translate(5.2 5.2) scale(0.9)">' +
    `<path fill="#ffffff" fill-rule="evenodd" d="${BRAND_PATH}" />` +
    '</g></svg>'
  );
}

/** `buildFaviconSvg`, wrapped as the `data:` URI a `<link rel="icon">` href takes. */
export function buildFaviconDataUri(stops: FaviconStops): string {
  return `data:image/svg+xml,${encodeURIComponent(buildFaviconSvg(stops))}`;
}
