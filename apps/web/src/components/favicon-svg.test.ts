import { describe, expect, it } from 'vitest';
import { BRAND_PATH } from '@/components/brand-mark';
import { buildFaviconDataUri, buildFaviconSvg } from '@/components/favicon-svg';

const STOPS = ['#111111', '#222222', '#333333'] as const;

describe('buildFaviconSvg', () => {
  it('draws BRAND_PATH, the same geometry constant the in-app mark uses', () => {
    // The whole point of this file: no second copy of the path data. If this
    // ever stops importing BRAND_PATH, the two marks can drift again exactly
    // the way the old hand-kept icon.svg did.
    expect(buildFaviconSvg(STOPS)).toContain(`d="${BRAND_PATH}"`);
  });

  it('places the three stops in ramp order', () => {
    const stops = [...buildFaviconSvg(STOPS).matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual([...STOPS]);
  });

  it('fills the glyph with evenodd, so the briefcase handle stays a real hole', () => {
    expect(buildFaviconSvg(STOPS)).toContain('fill-rule="evenodd"');
  });
});

describe('buildFaviconDataUri', () => {
  it('wraps the svg as an encoded data: URI', () => {
    const uri = buildFaviconDataUri(STOPS);

    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(uri.slice('data:image/svg+xml,'.length))).toBe(
      buildFaviconSvg(STOPS),
    );
  });
});
