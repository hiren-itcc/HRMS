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
import { cn } from '@hrms/ui/lib/utils';
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
  const { setTheme, resolvedTheme } = useTheme();
  const { theme: color, setTheme: setColor } = useColorTheme();
  const isDark = resolvedTheme === 'dark';

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
              The swatch is the theme's own --primary, read from a nested
              data-theme rather than a hardcoded hex: one source for the colour,
              so a swatch cannot drift from the theme it advertises. The default
              carries no attribute, because `:root` already is it.

              `dark` goes on the same element on purpose — the dark blocks are
              `.dark[data-theme=x]`, both on one element, so a swatch with only
              the attribute would advertise the light palette at night.
            */}
            <span
              data-theme={t.name === 'terracotta' ? undefined : t.name}
              className={cn('size-4 shrink-0 rounded-full border bg-primary', isDark && 'dark')}
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
