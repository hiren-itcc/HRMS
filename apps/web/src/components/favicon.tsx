'use client';

import { useEffect } from 'react';
import { buildFaviconDataUri, type FaviconStops } from '@/components/favicon-svg';

/** Marks the `<link>` this component owns, so a re-mount finds and reuses it rather than appending another. */
const LINK_MARKER = 'data-favicon-theme';

const RAMP_PROPERTIES = ['--brand-ramp-1', '--brand-ramp-2', '--brand-ramp-3'] as const;

/**
 * Resolves any CSS colour the browser accepts — including `oklch()`, which is
 * what `--brand-ramp-*` is written in — to a plain `#rrggbb` string.
 *
 * Two techniques were tried against the real Edge/Chromium on this machine
 * before landing on this one (see `favicon-theme-report.md` for the full
 * trace):
 *
 * - Setting `ctx.fillStyle` and reading the property back does **not**
 *   convert `oklch()` to hex here — the getter echoes the identical
 *   `oklch(...)` string. Modern engines serialise `fillStyle` back in
 *   whatever colour space it was given rather than always sRGB, so the
 *   commonly-cited "set fillStyle, read fillStyle" trick silently does not
 *   do the conversion for this input.
 * - Actually painting a pixel and reading the rendered bytes back with
 *   `getImageData` does work: rasterising has to resolve the colour to sRGB
 *   bytes regardless of how the engine reports the string, so it is immune
 *   to that serialisation choice. Checked against the real terracotta
 *   `--brand-ramp-1` value — it comes back `#923f33`, the exact hex
 *   `icon.svg` hardcodes for that stop.
 */
function resolveToHex(cssColor: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return cssColor;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function currentStops(): FaviconStops {
  const styles = getComputedStyle(document.documentElement);
  const [stop1, stop2, stop3] = RAMP_PROPERTIES.map((name) =>
    resolveToHex(styles.getPropertyValue(name).trim()),
  );
  return [stop1, stop2, stop3];
}

/**
 * The `<link>` this component owns, created once and reused.
 *
 * Next already emits its own `<link rel="icon" href="/icon.svg">` for the
 * static file — that one is left completely alone, both as the pre-hydration
 * icon and as the no-JS fallback. This is a second, separate link rather than
 * a rewrite of Next's: per the HTML "list of icons" algorithm, when several
 * equally-appropriate `<link rel="icon">` elements exist a user agent should
 * prefer the last one in tree order, so appending this one after Next's makes
 * it win once it exists, with nothing removed or overwritten.
 */
function ownedLink(): HTMLLinkElement {
  const existing = document.querySelector<HTMLLinkElement>(`link[${LINK_MARKER}]`);
  if (existing) return existing;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.setAttribute(LINK_MARKER, '');
  document.head.appendChild(link);
  return link;
}

/**
 * Regenerates the tab icon from the live theme.
 *
 * `icon.svg` is what renders before this has ever run — first paint, and
 * anyone with JS off. This takes over after that: same geometry
 * (`BRAND_PATH`, via `buildFaviconSvg`) but built from whichever
 * `--brand-ramp-*` triple the *current* theme resolves to, instead of the
 * terracotta baked into the static file.
 *
 * Mount once, wherever a signed-in user always lands — the dashboard layout
 * does this. Renders nothing.
 */
export function Favicon() {
  useEffect(() => {
    const apply = () => {
      ownedLink().href = buildFaviconDataUri(currentStops());
    };

    apply();

    // Both theme axes land as attributes on <html>: `data-theme` is written
    // by color-theme.tsx, and next-themes toggles the `.dark` class there
    // too — one observer covers both without subscribing to either
    // mechanism directly.
    const observer = new MutationObserver(apply);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    });

    return () => observer.disconnect();
  }, []);

  return null;
}
