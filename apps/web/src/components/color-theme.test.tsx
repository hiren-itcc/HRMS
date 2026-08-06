import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COLOR_THEME_SCRIPT, DEFAULT_THEME, THEME_STORAGE_KEY, useColorTheme } from './color-theme';

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
