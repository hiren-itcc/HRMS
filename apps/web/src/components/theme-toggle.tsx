'use client';

import { Button } from '@hrms/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@hrms/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { COLOR_THEMES, useColorTheme } from '@/components/color-theme';

/**
 * Two independent choices in one menu: light/dark, and the palette.
 *
 * They are separate on purpose — someone who wants Emerald wants it in both
 * modes, and someone who works at night still wants their colour. Every theme
 * ships a light and a dark block, so the two axes compose.
 */
export function ThemeToggle() {
  const { setTheme } = useTheme();
  const { theme: color, setTheme: setColor } = useColorTheme();

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" aria-label="Change theme" />}
            />
          }
        >
          <Sun className="size-4 dark:hidden" aria-hidden />
          <Moon className="hidden size-4 dark:block" aria-hidden />
        </TooltipTrigger>
        <TooltipContent>Change theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun aria-hidden /> Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon aria-hidden /> Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor aria-hidden /> System
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuLabel>Colour</DropdownMenuLabel>
        {COLOR_THEMES.map((t) => (
          <DropdownMenuItem key={t.name} onClick={() => setColor(t.name)}>
            {/*
              `--swatch-<name>`, generated alongside the themes, rather than a
              nested `data-theme` reading `--primary`.

              That was the first attempt and it got the default wrong: the
              default theme carries no attribute, because `:root` already is
              terracotta — so the span inherited `--primary` from `<html>`,
              which is whatever theme is *currently* applied. Terracotta always
              wore the colour of the selected theme.

              These variables are set on `:root` and `.dark` only, and nothing
              overrides them, so each swatch shows its own theme in both modes.
            */}
            <span
              style={{ backgroundColor: `var(--swatch-${t.name})` }}
              className="size-4 shrink-0 rounded-full border"
              aria-hidden
            />
            <span className="flex-1">{t.label}</span>
            {color === t.name && <Check className="size-4 opacity-70" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
