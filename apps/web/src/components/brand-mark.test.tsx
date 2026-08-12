import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BRAND_PATH, BrandGlyph, BrandMark } from '@/components/brand-mark';

// Read the favicon as a file, deliberately the long way round. The obvious
// `new URL('../app/icon.svg', import.meta.url)` does not work here: Vite
// statically matches that exact pattern and rewrites it into an asset
// reference, so what comes back is a base64 `data:` URL of the file rather
// than a path to it. Deriving the directory first never trips the transform.
const ICON_SVG = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../app/icon.svg'),
  'utf8',
);

/**
 * The favicon is a hand-kept copy of the component's geometry — Next serves
 * `app/icon.svg` statically, so it cannot import `BRAND_PATH`.
 *
 * That duplication is exactly how the previous mark rotted: a shield drawn two
 * ways with only a comment claiming they matched, and by the time anyone
 * looked the favicon was still knocking its tick out in a colour the app had
 * stopped using. This suite is the thing the comment should have been.
 */
describe('brand mark', () => {
  it('draws the same geometry in the favicon as in the component', () => {
    const paths = [...ICON_SVG.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);

    expect(paths).toEqual([BRAND_PATH]);
  });

  it('parses as XML, because a standalone .svg is not parsed as HTML', () => {
    // The bug this exists for: an XML comment may not contain `--` anywhere
    // inside it, and the note above the artwork wanted to name the
    // `brand-ramp-*` custom properties. Written with their leading dashes the
    // whole file is malformed, the browser renders nothing, and every softer
    // check still passes — it lints, it serves 200 as image/svg+xml, and the
    // path data still matches the component. Only an actual parse catches it.
    const doc = new DOMParser().parseFromString(ICON_SVG, 'image/svg+xml');

    expect(doc.querySelector('parsererror')).toBeNull();
    expect(doc.documentElement.tagName).toBe('svg');
  });

  it('fills the favicon with evenodd, so the briefcase handle is a real hole', () => {
    // Not decoration: the old favicon overpainted its cut-out in a flat colour,
    // which is why it could not share a path with a component sitting on a CSS
    // gradient. Lose the fill rule and the handle silently fills in.
    expect(ICON_SVG).toContain('fill-rule="evenodd"');
  });

  it('keeps the favicon on the compiled --brand-ramp-* stops', () => {
    // A favicon reads no CSS variables. If the ramp in globals.css moves, this
    // assertion is the reminder that these three hexes have to move with it.
    expect(ICON_SVG).toContain('#923f33');
    expect(ICON_SVG).toContain('#aa4a30');
    expect(ICON_SVG).toContain('#bc5a31');
  });

  it('leaves the glyph unnamed, because every call site names itself', () => {
    // Two accessible names on one link announces the brand twice. The sidebar
    // and header carry aria-label="HRMS home"; auth and careers sit beside the
    // word itself.
    const { container } = render(<BrandGlyph />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('sizes the tile and the glyph together', () => {
    const { container: small } = render(<BrandMark />);
    const { container: large } = render(<BrandMark size="lg" />);

    expect(small.firstElementChild).toHaveClass('size-8', 'rounded-lg');
    expect(small.querySelector('svg')).toHaveClass('size-5');
    expect(large.firstElementChild).toHaveClass('size-10', 'rounded-xl');
    expect(large.querySelector('svg')).toHaveClass('size-6');
  });

  it('carries the gradient tile and merges a caller class', () => {
    const { container } = render(<BrandMark className="shadow-lg" />);

    expect(container.firstElementChild).toHaveClass('gradient-primary', 'shadow-lg');
  });
});
