'use client';

import { COLOR_THEMES, DEFAULT_THEME, isColorTheme } from '@hrms/ui/lib/themes';
import { useCallback, useEffect, useState } from 'react';

export { COLOR_THEMES, DEFAULT_THEME };

export const THEME_STORAGE_KEY = 'hrms-color-theme';

/**
 * The colour theme, as a `data-theme` attribute on `<html>`.
 *
 * Two axes, two mechanisms. next-themes owns light/dark and models exactly one
 * choice, so the palette gets its own — forty lines rather than bending a
 * library into a shape it does not have.
 *
 * Terracotta is `:root` and carries no attribute: an unrecognised or missing
 * value therefore lands on the theme people already had, which is the right
 * failure for a stale key written by some future version.
 *
 * The attribute is set *before hydration* by the inline script in
 * `app/layout.tsx`. This hook only reads back what that script decided and
 * writes changes; doing the initial read here instead would paint terracotta
 * first and swap on mount, which is the flash the script exists to prevent.
 */
export function useColorTheme() {
  const [theme, setThemeState] = useState<string>(DEFAULT_THEME);

  useEffect(() => {
    const applied = document.documentElement.dataset.theme;
    setThemeState(isColorTheme(applied) ? applied : DEFAULT_THEME);
  }, []);

  const setTheme = useCallback((next: string) => {
    const value = isColorTheme(next) ? next : DEFAULT_THEME;
    setThemeState(value);
    if (value === DEFAULT_THEME) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, value);
    } catch {
      // Private browsing, or storage full. The theme still applies for this
      // page; only remembering it fails, and that is not worth an error.
    }
  }, []);

  return { theme, setTheme };
}

/**
 * Runs before first paint, from `<head>`. Kept as a string because it has to
 * be inlined — a module would be fetched and parsed after the first paint,
 * which is exactly too late.
 */
export const COLOR_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');var ok=${JSON.stringify(
  COLOR_THEMES.map((t) => t.name),
)}.indexOf(t)>-1;if(ok&&t!=='${DEFAULT_THEME}')document.documentElement.dataset.theme=t;}catch(e){}})();`;
