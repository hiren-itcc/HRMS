import { cn } from '@hrms/ui/lib/utils';

/**
 * The HRMS mark: three figures where the centre one's torso is a briefcase.
 *
 * Drawn here rather than taken from an icon set. The stock "job seeker" icon
 * this replaced was five outlined figures at roughly fourteen strokes — which
 * is a grey smudge in a browser tab — and its licence bars using the artwork
 * "in any trademark, or part of the same", which is exactly what a product
 * logo is. So: same idea, original geometry, ours outright.
 *
 * Design constraints, all of them checked by rendering at 16px rather than
 * assumed:
 *
 * - **Filled shapes, never strokes.** A 2px stroke at 24 units is a third of a
 *   pixel at favicon size and anti-aliases into fog. This is the same lesson
 *   the shield it replaced had already learnt — see the note in `icon.svg`.
 * - **Holes are `fill-rule="evenodd"`, not overpainted.** The old favicon faked
 *   its tick by drawing over the shield in the background colour, which is why
 *   the in-app copy could not share the path: over a *CSS* gradient a solid
 *   knockout is visibly wrong. A real hole lets whatever is behind show
 *   through, so one `d` now serves both the component and the favicon — and
 *   `brand-mark.test.tsx` fails if the two ever drift apart.
 * - **No clasp on the briefcase.** It was drawn, rendered, and cut: at 16 and
 *   20px it collapsed into a muddy pixel in the middle of the case. The handle
 *   alone carries the reading.
 *
 * The glyph is wider than it is tall (about 21 × 17.5 of the 24 box), so it
 * reads optically smaller than the square shield did at the same box size.
 * That is why the tile below gives it more room than the old `size-4.5`.
 */
export const BRAND_PATH =
  'M9 5.9a3 3 0 1 0 6 0 3 3 0 1 0-6 0ZM1.8 8.4a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0ZM17.8 8.4a2.2 2.2 0 1 0 4.4 0 2.2 2.2 0 1 0-4.4 0ZM1.6 19.3v-5.7a1.9 1.9 0 0 1 1.9-1.9h1a1.9 1.9 0 0 1 1.9 1.9v5.7a1.1 1.1 0 0 1-1.1 1.1H2.7a1.1 1.1 0 0 1-1.1-1.1ZM17.6 19.3v-5.7a1.9 1.9 0 0 1 1.9-1.9h1a1.9 1.9 0 0 1 1.9 1.9v5.7a1.1 1.1 0 0 1-1.1 1.1H18.7a1.1 1.1 0 0 1-1.1-1.1ZM9.7 12.5v-1.3a1.5 1.5 0 0 1 1.5-1.5h1.6a1.5 1.5 0 0 1 1.5 1.5v1.3ZM11.1 12.5v-1.2a.4.4 0 0 1 .4-.4h1a.4.4 0 0 1 .4.4v1.2ZM8.8 12.5h6.4a1.6 1.6 0 0 1 1.6 1.6v4.7a1.6 1.6 0 0 1-1.6 1.6H8.8a1.6 1.6 0 0 1-1.6-1.6v-4.7a1.6 1.6 0 0 1 1.6-1.6Z';

/**
 * The bare glyph, no tile. `currentColor` so it inherits, `aria-hidden` because
 * every site that draws it already names itself — the sidebar and header links
 * carry `aria-label="HRMS home"`, and the auth and careers headers sit beside
 * the word. A second accessible name here would announce the brand twice.
 */
export function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path fill="currentColor" fillRule="evenodd" d={BRAND_PATH} />
    </svg>
  );
}

/**
 * Tile sizes. The glyph fraction is 0.625 at `sm` and 0.6 at `lg` — both a
 * little more generous than the 0.5625 the shield used, for the aspect-ratio
 * reason above.
 */
const TILE = {
  sm: { box: 'size-8 rounded-lg', glyph: 'size-5' },
  lg: { box: 'size-10 rounded-xl', glyph: 'size-6' },
} as const;

interface BrandMarkProps {
  size?: keyof typeof TILE;
  /** Per-site shadow. The five call sites differ in nothing else. */
  className?: string;
}

/**
 * The mark on its gradient tile — the brand as it appears in the sidebar, the
 * header sheet, the auth panels and the careers header.
 *
 * One component because it used to be five inline copies, and one of them had
 * already drifted: the public careers header rendered the literal text `HR`
 * where every other place drew the icon.
 *
 * The tile is `.gradient-primary`, so it follows `--brand-ramp-*` and changes
 * with the theme. `icon.svg` cannot — a favicon reads no CSS variables — which
 * is why that one file hardcodes the default terracotta.
 */
export function BrandMark({ size = 'sm', className }: BrandMarkProps) {
  const tile = TILE[size];
  return (
    <span
      className={cn(
        'gradient-primary flex shrink-0 items-center justify-center text-white',
        tile.box,
        className,
      )}
    >
      <BrandGlyph className={tile.glyph} />
    </span>
  );
}
