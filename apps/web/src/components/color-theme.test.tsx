import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  COLOR_THEME_SCRIPT,
  COLOR_THEMES,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  useColorTheme,
} from './color-theme';

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe('useColorTheme', () => {
  it('reads back the theme the pre-paint script applied', () => {
    document.documentElement.dataset.theme = 'emerald';
    const { result } = renderHook(() => useColorTheme());
    expect(result.current.theme).toBe('emerald');
  });

  it('writes the attribute and remembers the choice', () => {
    const { result } = renderHook(() => useColorTheme());
    act(() => result.current.setTheme('indigo'));

    expect(document.documentElement.dataset.theme).toBe('indigo');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('indigo');
  });

  /*
   * Terracotta is `:root`. Leaving `data-theme="terracotta"` on the element
   * would be a selector nothing matches — harmless today and a trap the first
   * time somebody writes one.
   */
  it('removes the attribute for the default rather than naming it', () => {
    const { result } = renderHook(() => useColorTheme());
    act(() => result.current.setTheme('violet'));
    act(() => result.current.setTheme(DEFAULT_THEME));

    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(DEFAULT_THEME);
  });

  /* A key written by a future version, or by hand. */
  it('falls back to the default for a theme it does not have', () => {
    document.documentElement.dataset.theme = 'chartreuse';
    const { result } = renderHook(() => useColorTheme());

    expect(result.current.theme).toBe(DEFAULT_THEME);

    act(() => result.current.setTheme('chartreuse'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});

describe('the menu swatches', () => {
  const themes = readFileSync(
    join(__dirname, '../../../../packages/ui/src/styles/themes.css'),
    'utf8',
  );

  /*
   * The bug this catches: the swatch used to read `--primary` under a nested
   * `data-theme`, and the default theme carries no attribute — so Terracotta
   * inherited whatever theme was applied and always matched the selection.
   * Every theme needs a colour of its own that nothing can override.
   */
  it('gives every theme in the menu a swatch of its own', () => {
    for (const { name } of COLOR_THEMES) {
      expect(themes).toContain(`--swatch-${name}:`);
    }
  });

  /* One set on :root, one on .dark, so a swatch is right at night too. */
  it('defines each swatch in both modes', () => {
    for (const { name } of COLOR_THEMES) {
      const occurrences = themes.split(`--swatch-${name}:`).length - 1;
      expect(occurrences).toBe(2);
    }
  });

  /* A swatch var nothing renders is dead CSS; a menu entry with no var is a
     blank circle. Neither should be possible. */
  it('has no swatch the menu does not show', () => {
    const declared = [...themes.matchAll(/--swatch-([\w-]+):/g)].map((m) => m[1]);
    for (const name of new Set(declared)) {
      expect(COLOR_THEMES.some((t) => t.name === name)).toBe(true);
    }
  });
});

describe('the pre-paint script', () => {
  /*
   * It runs before React exists, so it gets no second chance and no error
   * boundary. These assert the two things that would break a first paint.
   */
  it('applies a stored theme with no framework present', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'amber');
    new Function(COLOR_THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBe('amber');
  });

  it('ignores a stored value that is not a theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'chartreuse');
    new Function(COLOR_THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('leaves the attribute off for the default', () => {
    localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME);
    new Function(COLOR_THEME_SCRIPT)();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
