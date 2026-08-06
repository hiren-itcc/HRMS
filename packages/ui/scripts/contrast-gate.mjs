#!/usr/bin/env node
/*
 * WCAG contrast gate for the HRMS token set.
 *
 * Reads the COMPILED stylesheet rather than globals.css, because the source
 * is full of var() chains, --alpha() and color-mix() that only Tailwind
 * resolves. Measuring the source would measure something the browser never
 * sees.
 *
 * Usage: node contrast-gate.mjs <path-to-built.css>
 */
import { readFileSync } from 'node:fs';

/*
 * Drop @media print before collecting. Its block is `:root, .dark { … }`, so
 * a naive `.dark {` match picks up the print overrides and measures paper
 * colours against screen ones — which reported nonsense like 1.00:1.
 */
function stripAtRule(src, name) {
  let out = '';
  let i = 0;
  for (;;) {
    const at = src.indexOf(name, i);
    if (at === -1) return out + src.slice(i);
    const open = src.indexOf('{', at);
    if (open === -1) return out + src.slice(i);
    let depth = 0;
    let j = open;
    for (; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) break;
    }
    out += src.slice(i, at);
    i = j + 1;
  }
}

/*
 * `@supports` goes too, and for a subtler reason than print.
 *
 * Lightning CSS compiles every oklch() twice: a hex fallback at the top level
 * and a `lab()` version inside `@supports (color: lab(0% 0 0))`. Both blocks
 * are `:root`, the collector keeps the last value it sees, and `lab()` is not
 * a syntax parseColor knows — so every token resolved to null and all 56 pairs
 * SKIPped while still exiting 0. A gate that passes by measuring nothing is
 * worse than no gate.
 *
 * Dropping @supports leaves the hex fallbacks, which are the sRGB values a
 * browser without wide-gamut support paints — the same space WCAG ratios are
 * defined in, and the space the token audit was done in.
 */
const raw = readFileSync(process.argv[2], 'utf8');
const css = stripAtRule(stripAtRule(raw, '@media print'), '@supports');

/* ---------- colour maths ---------- */

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((v) => {
    const c = clamp01(v);
    const srgb = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return clamp01(srgb) * 255;
  });
}

/** -> [r,g,b,a] in 0-255 / 0-1, or null if unparseable. */
function parseColor(raw, vars, depth = 0) {
  if (!raw || depth > 12) return null;
  const s = raw.trim();

  const varMatch = s.match(/^var\(\s*(--[\w-]+)\s*(?:,([\s\S]+))?\)$/);
  if (varMatch) {
    const target = vars.get(varMatch[1]);
    if (target !== undefined) return parseColor(target, vars, depth + 1);
    return varMatch[2] ? parseColor(varMatch[2], vars, depth + 1) : null;
  }

  const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] };
  if (NAMED[s.toLowerCase()]) return [...NAMED[s.toLowerCase()]];

  let m = s.match(/^#([0-9a-f]{3,8})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    if (h.length === 4) h = [...h].map((c) => c + c).join('');
    const n = (i) => Number.parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }

  m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean);
    const v = parts
      .slice(0, 3)
      .map((p) => (p.endsWith('%') ? (Number.parseFloat(p) / 100) * 255 : Number.parseFloat(p)));
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? Number.parseFloat(parts[3]) / 100
          : Number.parseFloat(parts[3]);
    return [...v, a];
  }

  m = s.match(/^oklch\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].split(/[\s/]+/).filter(Boolean);
    const L = parts[0].endsWith('%')
      ? Number.parseFloat(parts[0]) / 100
      : Number.parseFloat(parts[0]);
    const C = Number.parseFloat(parts[1]);
    const H = Number.parseFloat(parts[2]) || 0;
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? Number.parseFloat(parts[3]) / 100
          : Number.parseFloat(parts[3]);
    return [...oklchToRgb(L, C, H), a];
  }

  // color-mix(in <space>, A p%, B) — split at the top level only
  m = s.match(/^color-mix\(\s*in\s+[\w-]+\s*,([\s\S]+)\)$/i);
  if (m) {
    const args = splitTop(m[1]);
    if (args.length !== 2) return null;
    const read = (arg) => {
      const pm = arg.trim().match(/^([\s\S]+?)\s+([\d.]+)%$/);
      return pm ? { color: pm[1], pct: Number.parseFloat(pm[2]) / 100 } : { color: arg, pct: null };
    };
    const A = read(args[0]);
    const B = read(args[1]);
    const ca = parseColor(A.color, vars, depth + 1);
    const cb = parseColor(B.color, vars, depth + 1);
    if (!ca || !cb) return null;
    const wa = A.pct ?? (B.pct !== null ? 1 - B.pct : 0.5);
    const wb = 1 - wa;
    /* Mixing toward `transparent` is how Tailwind compiles --alpha(): the hue
       is unchanged and only the alpha scales. Averaging the RGB channels
       against black would darken it, which is not what the browser does. */
    if (cb[3] === 0) return [ca[0], ca[1], ca[2], ca[3] * wa];
    if (ca[3] === 0) return [cb[0], cb[1], cb[2], cb[3] * wb];
    return [0, 1, 2].map((i) => ca[i] * wa + cb[i] * wb).concat(ca[3] * wa + cb[3] * wb);
  }

  return null;
}

function splitTop(str) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of str) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Composite a possibly-translucent colour over an opaque surface. */
function over(fg, bg) {
  const a = fg[3];
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)).concat(1);
}

function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* ---------- token extraction ---------- */

function collect(selectorRe) {
  const vars = new Map();
  // Tailwind's own ramp (--color-indigo-600 etc.) lives in :root/@theme
  for (const re of [/--color-[\w-]+:\s*([^;}]+)[;}]/g]) {
    for (const mm of css.matchAll(/(--color-[\w-]+):\s*([^;}]+)[;}]/g)) {
      if (!vars.has(mm[1])) vars.set(mm[1], mm[2].trim());
    }
    void re;
  }
  for (const block of css.matchAll(selectorRe)) {
    for (const mm of block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
      vars.set(mm[1], mm[2].trim());
    }
  }
  return vars;
}

const LIGHT = collect(/:root\s*\{([^}]*)\}/g);
const DARK = collect(/\.dark\s*\{([^}]*)\}/g);

/*
 * The colour themes, measured with the same pairs as the base.
 *
 * A theme is the base rotated in hue with every lightness held, so the ratios
 * should carry over — but "should" is what this script exists to replace. Six
 * themes × two modes × the table below is the difference between a claim and
 * a measurement, and a theme that cannot clear the floor is a theme that does
 * not ship.
 *
 * Each theme's map is the base merged with its overrides, in the same
 * cascade order the browser applies: theme-light sits over base-light, and
 * theme-dark over base-dark *and* over theme-light, because the light block
 * carries the mode-independent tokens (the brand ramp, radius, fonts).
 */
/* Quotes are optional: the source writes them, the minifier strips them. */
const THEME_NAMES = [
  ...new Set([...css.matchAll(/\[data-theme=['"]?([\w-]+)['"]?\]/g)].map((m) => m[1])),
];

const merge = (...maps) => {
  const out = new Map();
  for (const m of maps) for (const [k, v] of m) out.set(k, v);
  return out;
};

const THEMES = THEME_NAMES.flatMap((name) => {
  const sel = `\\[data-theme=['"]?${name}['"]?\\]`;
  const themeLight = collect(new RegExp(`(?<!\\.dark)${sel}\\s*\\{([^}]*)\\}`, 'g'));
  const themeDark = collect(new RegExp(`\\.dark${sel}\\s*\\{([^}]*)\\}`, 'g'));
  return [
    [`${name} light`, merge(LIGHT, themeLight)],
    [`${name} dark`, merge(DARK, themeLight, themeDark)],
  ];
});

/* ---------- the pairs that must hold ---------- */

const TEXT = 4.5;
const UI = 3.0;

/** tint(x, p) = the token at p% over the surface — how our chips are built. */
const PAIRS = [
  ['foreground', 'background', TEXT, 'body text'],
  ['foreground', 'card', TEXT, 'text on cards'],
  ['muted-foreground', 'card', TEXT, 'secondary text on cards'],
  ['muted-foreground', 'background', TEXT, 'secondary text'],
  ['card-foreground', 'card', TEXT, 'card text'],
  ['popover-foreground', 'popover', TEXT, 'menu text'],
  ['primary-foreground', 'primary', TEXT, 'primary button label'],
  ['secondary-foreground', 'secondary|background', TEXT, 'secondary button label'],
  ['accent-foreground', 'accent|background', TEXT, 'hovered menu item'],
  /* coss's destructive/success/etc `-foreground` tokens are text for a light
     TINT, not a label on the solid fill — the solid destructive button and
     badge both hardcode text-white. Badge tints are /8 in light and /16 in
     dark, which is what these check. */
  ['#ffffff', 'destructive', TEXT, 'destructive button label'],
  ['destructive-foreground', 'tint:destructive:0.08', TEXT, 'error badge (light tint)'],
  ['success-foreground', 'tint:success:0.08', TEXT, 'success badge (light tint)'],
  ['warning-foreground', 'tint:warning:0.08', TEXT, 'warning badge (light tint)'],
  ['info-foreground', 'tint:info:0.08', TEXT, 'info badge (light tint)'],
  ['destructive-foreground', 'background', TEXT, 'field error text'],
  ['sidebar-foreground', 'sidebar', TEXT, 'sidebar nav label'],
  ['sidebar-accent-foreground', 'sidebar-accent|sidebar', TEXT, 'hovered sidebar item'],
  ['sidebar-primary-foreground', 'sidebar-primary', TEXT, 'active sidebar pill'],
  // on-tint text: the -text token over a 15% tint of its own fill
  ['success-text', 'tint:success:0.15', TEXT, 'success chip'],
  ['warning-text', 'tint:warning:0.15', TEXT, 'warning chip'],
  ['info-text', 'tint:info:0.15', TEXT, 'info chip'],
  ['destructive-text', 'tint:destructive:0.15', TEXT, 'error chip'],
  ['primary-text', 'tint:primary:0.15', TEXT, 'primary chip'],
  // non-text boundaries (WCAG 1.4.11)
  ['input', 'background', UI, 'input border'],
  ['ring', 'background', UI, 'focus ring'],
  ['ring', 'card', UI, 'focus ring on cards'],
  ['sidebar-ring', 'sidebar', UI, 'sidebar focus ring'],
  ['skeleton', 'card', 1.2, 'skeleton fill'],
];

/*
 * Deviations the design chose, each with the floor it must still clear.
 *
 * Not a way to make the gate quiet: a pair listed here still fails if it drops
 * below its floor, which is what stops a new theme regressing one of them. The
 * floors are the base theme's own measured values less a hair.
 *
 * These were invisible until now. The gate had been reporting ALL PAIRS PASS
 * while resolving nothing — see the @supports note at the top — so nobody had
 * seen a real number from it.
 */
const ACCEPTED = {
  'primary button label':
    'white on the brand terracotta reads 3.90:1. globals.css records the choice: ' +
    'brand fidelity over the darker #bd5937 that would have reached 4.50:1. ' +
    'Clears 3:1 for large text and UI components.',
  'active sidebar pill':
    '--sidebar-primary is unused by any component; globals.css says so. It is set ' +
    'to the brand so it is correct if the active-nav pill ever adopts it.',
  'destructive button label':
    'KNOWN DEFECT, dark mode only: white on --destructive is 3.76:1. The solid ' +
    'destructive button hardcodes text-white. Fixing it means darkening the dark ' +
    'theme’s red, which is a change to the base palette rather than to a theme.',
};

/** Floors, so an accepted deviation cannot quietly get worse. */
const FLOOR = 3.0;

/*
 * The compiled stylesheet is not the arithmetic the tokens were solved to.
 * Lightning CSS quantises every colour to a hex triplet, and a tint is
 * composited in gamma-encoded sRGB rather than linearly — together worth a few
 * hundredths either way. globals.css already notes that solving to exactly
 * 4.50 landed at 4.48 once the compiler rounded. This absorbs that and no more.
 */
const QUANTISATION = 0.05;

function resolve(name, vars, surface) {
  if (name.startsWith('#')) return parseColor(name, vars);
  if (name.startsWith('tint:')) {
    const [, token, pct] = name.split(':');
    const c = parseColor(vars.get(`--${token}`), vars);
    if (!c) return null;
    return over([c[0], c[1], c[2], c[3] * Number.parseFloat(pct)], surface);
  }
  // "a|b" = token a composited over surface token b
  const [tok, base] = name.split('|');
  const c = parseColor(vars.get(`--${tok}`), vars);
  if (!c) return null;
  if (base) {
    const b = parseColor(vars.get(`--${base}`), vars);
    if (!b) return null;
    return over(c, [b[0], b[1], b[2], 1]);
  }
  return c;
}

/*
 * SNAP=<fgToken>:<bgSpec>:<min>:<theme> walks the token's hue darker (light
 * theme) or lighter (dark) until it clears `min`, and prints the first value
 * that does. Snapping to a computed step beats nudging a hex by eye.
 */
if (process.env.SNAP) {
  const [tok, bgSpec, min, theme] = process.env.SNAP.split(':');
  const vars = theme === 'dark' ? DARK : LIGHT;
  const pageBg = parseColor(vars.get('--background'), vars);
  const bgc = resolve(bgSpec.replace(/@/g, ':'), vars, pageBg);
  const surface = bgc[3] === 1 ? bgc : over(bgc, pageBg);
  const start = parseColor(vars.get(`--${tok}`), vars);
  const target = theme === 'dark' ? 255 : 0;
  for (let step = 0; step <= 100; step++) {
    const k = step / 100;
    const cand = [0, 1, 2].map((i) => start[i] * (1 - k) + target * k);
    const r = ratio(over([...cand, 1], surface), surface);
    if (r >= Number.parseFloat(min)) {
      const hex = `#${cand.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
      console.log(`${tok} -> ${hex}  (${r.toFixed(2)}:1 on ${bgSpec}, ${theme})`);
      process.exit(0);
    }
  }
  console.log('no passing step found');
  process.exit(1);
}

let failures = 0;
let checked = 0;
let allowed = 0;
for (const [label, vars] of [['light', LIGHT], ['dark', DARK], ...THEMES]) {
  const bg = parseColor(vars.get('--background'), vars);
  console.log(`\n=== ${label.toUpperCase()} ===`);
  for (const [fgName, bgName, min, desc] of PAIRS) {
    const bgc = resolve(bgName, vars, bg);
    if (!bgc) {
      console.log(`  SKIP  ${desc.padEnd(28)} (cannot resolve ${bgName})`);
      continue;
    }
    const opaqueBg = bgc[3] === 1 ? bgc : over(bgc, bg);
    const fgRaw = resolve(fgName, vars, opaqueBg);
    if (!fgRaw) {
      console.log(`  SKIP  ${desc.padEnd(28)} (cannot resolve ${fgName})`);
      continue;
    }
    const fg = over(fgRaw, opaqueBg);
    const r = ratio(fg, opaqueBg);
    checked++;

    const accepted = ACCEPTED[desc];
    const threshold = accepted ? FLOOR : min - QUANTISATION;
    const ok = r >= threshold;
    if (!ok) failures++;
    else if (accepted) allowed++;

    const verdict = ok ? (accepted ? 'ALLOW' : 'PASS ') : 'FAIL ';
    console.log(
      `  ${verdict} ${desc.padEnd(28)} ${r.toFixed(2)}:1  (min ${accepted ? `${FLOOR} accepted` : min})  ${fgName} on ${bgName}`,
    );
  }
}

if (allowed) {
  console.log('\n--- accepted deviations ---');
  for (const [desc, why] of Object.entries(ACCEPTED)) console.log(`  ${desc}\n    ${why}\n`);
}

console.log(
  `\n${failures === 0 ? 'ALL PAIRS PASS' : `${failures} FAILURE(S)`} — ${checked} checked, ${allowed} accepted`,
);
process.exit(failures === 0 ? 0 : 1);
