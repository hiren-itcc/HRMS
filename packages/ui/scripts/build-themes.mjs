#!/usr/bin/env node
/*
 * Derives the colour themes from the audited base theme.
 *
 * Every token in globals.css was argued for — six were corrected outright,
 * each carrying the ratio that condemned the original — and
 * `contrast-gate.mjs` measures 56 pairs against them. Hand-picking five more
 * palettes would be ~550 more values with none of that behind them, and
 * hand-picked colour is exactly how a 4.6:1 label quietly becomes 3.2:1.
 *
 * So a theme is not a palette. A theme is a **rotation**: every token keeps
 * the base theme's lightness exactly and moves only in hue and chroma. In
 * OKLCH, contrast is dominated by L, so holding L holds the audit — and the
 * gate then re-measures all six to prove it rather than to assume it.
 *
 * Output: src/styles/themes.css, committed. Generated, but a person debugs
 * CSS at 2am and should find it on disk rather than in a build step.
 *
 *   pnpm --filter @hrms/ui themes
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src/styles/globals.css');
const OUTPUT = join(ROOT, 'src/styles/themes.css');

/* ---------- the themes ---------- */

/**
 * `brandHue` / `neutralHue` are absolute OKLCH hues; the base is ~39 (clay)
 * and ~95–107 (warm cream). The chroma factors scale what is already there,
 * so a token that is nearly grey stays nearly grey.
 *
 * `font` is null for the families that stay on Inter — a page should not
 * carry a webfont it never renders.
 */
/** The base theme, which `:root` already renders and no block overrides. */
const DEFAULT_THEME_NAME = 'terracotta';
const DEFAULT_THEME_LABEL = 'Terracotta';

const THEMES = [
  {
    name: 'indigo',
    label: 'Indigo',
    radius: '0.75rem',
    brandHue: 274,
    brandChroma: 1,
    neutralHue: 275,
    neutralChroma: 1.1,
    font: null,
  },
  {
    name: 'emerald',
    label: 'Emerald',
    radius: '0.375rem',
    brandHue: 163,
    brandChroma: 0.92,
    neutralHue: 165,
    neutralChroma: 1,
    font: null,
  },
  {
    name: 'violet',
    label: 'Violet',
    radius: '1rem',
    brandHue: 305,
    brandChroma: 1,
    neutralHue: 300,
    neutralChroma: 1.05,
    font: '"Plus Jakarta Sans Variable", "Inter Variable", system-ui, sans-serif',
  },
  {
    name: 'amber',
    label: 'Amber',
    radius: '0.25rem',
    brandHue: 74,
    brandChroma: 0.95,
    neutralHue: 92,
    neutralChroma: 1,
    font: '"Plus Jakarta Sans Variable", "Inter Variable", system-ui, sans-serif',
  },
  {
    name: 'slate',
    label: 'Slate',
    radius: '0.125rem',
    brandHue: 252,
    // Deliberately desaturated: this is the theme for somebody who wants the
    // chrome to disappear. Any lower and --ring stops clearing 3:1.
    brandChroma: 0.55,
    neutralHue: 255,
    neutralChroma: 0.9,
    font: null,
  },
];

/**
 * Which tokens move with the brand, and which are the tinted neutrals.
 * Anything named in neither is left to the base — that is where the status
 * colours live, and a green that means "approved" must mean it in every
 * theme.
 */
const BRAND = [
  'primary',
  'ring',
  'sidebar-primary',
  'sidebar-ring',
  'chart-1',
  'brand-ramp-1',
  'brand-ramp-2',
  'brand-ramp-3',
  'primary-text',
];

const NEUTRAL = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'border',
  'input',
  'skeleton',
  'sidebar',
  'sidebar-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'code',
];

/* ---------- colour maths ---------- */

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function oklchToLinearRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (L, C, H) => oklchToLinearRgb(L, C, H).every((v) => v >= -0.0005 && v <= 1.0005);

/**
 * The highest chroma at this lightness and hue that sRGB can actually show.
 *
 * Without this the generator can emit a colour the browser has to gamut-map
 * and the contrast gate clamps — two different answers for one token, and the
 * measured ratio stops describing the rendered pixel. Bisection is exact
 * enough at four decimal places and costs nothing at five themes.
 */
function fitChroma(L, C, H) {
  if (inGamut(L, C, H)) return C;
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(L, mid, H)) lo = mid;
    else hi = mid;
  }
  return lo;
}

const linToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG relative luminance of an OKLCH colour, via clamped sRGB. */
function luminance(L, C, H) {
  const [r, g, b] = oklchToLinearRgb(L, C, H).map(clamp01);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The lightness at this hue that reproduces the base colour's luminance.
 *
 * This is the correction that makes the whole approach honest. OKLCH `L` is
 * *perceptual* lightness; WCAG contrast is *relative luminance*, and the two
 * diverge with hue — a green and a red at the same L differ by half a stop of
 * luminance. Holding L therefore does not hold contrast: rotating terracotta
 * to emerald at a fixed L took white-on-primary from 3.90:1 down to 3.48:1,
 * a real regression on every primary button in the app.
 *
 * Matching luminance instead preserves every ratio the token takes part in —
 * against white, against the page, against its own tint — by construction
 * rather than by hope. Luminance is monotonic in L at fixed hue and chroma,
 * so bisection is exact.
 */
function matchLuminance(target, C, H) {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(mid, fitChroma(mid, C, H), H) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hexToOklch(hex) {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = srgbToLin(((n >> 16) & 255) / 255);
  const g = srgbToLin(((n >> 8) & 255) / 255);
  const b = srgbToLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let H = (Math.atan2(B, A) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, Math.hypot(A, B), H];
}

/* ---------- reading the base ---------- */

const css = readFileSync(SOURCE, 'utf8');

/** The declarations inside a top-level block, in source order. */
function block(selector) {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block in globals.css`);
  const open = css.indexOf('{', start);
  let depth = 0;
  let i = open;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) break;
  }
  const body = css.slice(open + 1, i);
  const out = new Map();
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

const LIGHT = block(':root');
const DARK = block('.dark');

/* ---------- deriving ---------- */

function rotate(value, hue, chromaFactor) {
  let L;
  let C;
  let H;
  const oklch = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i);
  if (oklch) {
    L = Number.parseFloat(oklch[1]);
    C = Number.parseFloat(oklch[2]);
    H = Number.parseFloat(oklch[3]);
  } else if (/^#[0-9a-f]{6}$/i.test(value)) {
    [L, C, H] = hexToOklch(value);
  } else {
    // var(), color-mix(), --alpha() — those resolve to other tokens that are
    // themselves themed, so rotating here would double-apply.
    return null;
  }
  // A token with no chroma is a true grey and must stay one; giving it a hue
  // would tint the one surface the theme has no business tinting.
  if (C < 0.0005) return null;

  // Luminance first, then the chroma that fits at the lightness it lands on.
  const target = luminance(L, C, H);
  const wanted = C * chromaFactor;
  const lightness = matchLuminance(target, wanted, hue);
  const fitted = fitChroma(lightness, wanted, hue);
  return `oklch(${+lightness.toFixed(4)} ${+fitted.toFixed(4)} ${+hue.toFixed(2)})`;
}

function derive(base, theme) {
  const out = new Map();
  for (const token of BRAND) {
    const value = base.get(`--${token}`);
    if (!value) continue;
    const next = rotate(value, theme.brandHue, theme.brandChroma);
    if (next) out.set(`--${token}`, next);
  }
  for (const token of NEUTRAL) {
    const value = base.get(`--${token}`);
    if (!value) continue;
    const next = rotate(value, theme.neutralHue, theme.neutralChroma);
    if (next) out.set(`--${token}`, next);
  }
  return out;
}

/* ---------- writing ---------- */

const declarations = (map, indent = '  ') =>
  [...map].map(([k, v]) => `${indent}${k}: ${v};`).join('\n');

const lines = [];
lines.push(`/*
 * GENERATED by scripts/build-themes.mjs — do not edit by hand.
 * Re-run: pnpm --filter @hrms/ui themes
 *
 * Each theme is the audited base theme rotated in hue: every lightness value
 * is the one contrast-gate.mjs already measured, so the ratios carry over and
 * the gate re-checks all six rather than taking it on trust. Status colours
 * (success/warning/info/destructive) and chart slots 2-5 are deliberately
 * absent — they are categorical, and a scale that moves with the chrome stops
 * telling things apart.
 *
 * ORDER IS LOAD-BEARING. The light blocks come BEFORE .dark and the dark
 * blocks after it:
 *
 *   :root                base light
 *   [data-theme=x]       theme light     <- equal specificity to .dark
 *   .dark                base dark       <- later, so it wins in dark mode
 *   .dark[data-theme=x]  theme dark      <- higher specificity, wins again
 *
 * Reversed, a token a theme sets in light but not in dark would keep its light
 * value on a dark background. This way it falls back to the base dark value,
 * which is merely unthemed rather than unreadable.
 */
`);

lines.push('/* ── theme light ─────────────────────────────────────────────── */\n');
for (const theme of THEMES) {
  const map = derive(LIGHT, theme);
  map.set('--radius', theme.radius);
  if (theme.font) {
    map.set('--font-sans-stack', theme.font);
    map.set('--font-heading-stack', theme.font);
  }
  // Double quotes because that is what Biome formats CSS to; emitting single
  // quotes made every regeneration produce a diff against the committed file.
  lines.push(`[data-theme="${theme.name}"] {\n${declarations(map)}\n}\n`);
}

lines.push('/* ── theme dark ──────────────────────────────────────────────── */\n');
for (const theme of THEMES) {
  lines.push(`.dark[data-theme="${theme.name}"] {\n${declarations(derive(DARK, theme))}\n}\n`);
}

writeFileSync(OUTPUT, `${lines.join('\n')}`, 'utf8');

/*
 * The same list, for the switcher. Emitted rather than hand-kept: a theme in
 * the CSS and not in the menu is invisible, and one in the menu but not the
 * CSS is a dead option — both are silent, and both are avoided by there being
 * one source.
 */
const TS = join(ROOT, 'src/lib/themes.ts');
writeFileSync(
  TS,
  `/* GENERATED by scripts/build-themes.mjs — do not edit by hand. */

/** The default. Rendered by \`:root\`, so it carries no \`data-theme\`. */
export const DEFAULT_THEME = 'terracotta';

export interface ColorTheme {
  name: string;
  label: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  { name: '${DEFAULT_THEME_NAME}', label: '${DEFAULT_THEME_LABEL}' },
${THEMES.map((t) => `  { name: '${t.name}', label: '${t.label}' },`).join('\n')}
];

export const isColorTheme = (value: unknown): value is string =>
  typeof value === 'string' && COLOR_THEMES.some((t) => t.name === value);
`,
  'utf8',
);

const clamped = [];
for (const theme of THEMES) {
  for (const [label, base] of [
    ['light', LIGHT],
    ['dark', DARK],
  ]) {
    for (const token of [...BRAND, ...NEUTRAL]) {
      const value = base.get(`--${token}`);
      if (!value) continue;
      const m = value.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+/);
      if (!m) continue;
      const L = Number.parseFloat(m[1]);
      const wanted =
        Number.parseFloat(m[2]) * (BRAND.includes(token) ? theme.brandChroma : theme.neutralChroma);
      const hue = BRAND.includes(token) ? theme.brandHue : theme.neutralHue;
      if (wanted > 0.0005 && fitChroma(L, wanted, hue) < wanted - 0.0005) {
        clamped.push(`${theme.name}/${label} --${token}`);
      }
    }
  }
}

console.log(`Wrote ${THEMES.length} themes to src/styles/themes.css`);
if (clamped.length) {
  console.log(
    `\n${clamped.length} token(s) had chroma reduced to stay inside sRGB — the requested\nsaturation was not displayable at that lightness and hue:\n  ${clamped.join('\n  ')}`,
  );
}
console.log('\nNow run the contrast gate over the compiled CSS. It is the actual check.');
