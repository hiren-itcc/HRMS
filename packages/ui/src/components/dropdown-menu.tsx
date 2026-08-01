'use client';

/*
 * coss names this primitive `Menu`; we had it as `DropdownMenu` across ~15
 * screens. Rather than rename every call site for no behavioural gain, this
 * file is an alias layer — the implementation is coss `menu.tsx`, unchanged.
 *
 * The one real API shift call sites do have to make is Radix's `onSelect`,
 * which Base UI spells `onClick`.
 */

import { cn } from '@hrms/ui/lib/utils';
import type React from 'react';

export {
  Menu as DropdownMenu,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuCreateHandle as DropdownMenuCreateHandle,
  MenuGroup as DropdownMenuGroup,
  MenuGroupLabel as DropdownMenuGroupLabel,
  MenuItem as DropdownMenuItem,
  MenuLinkItem as DropdownMenuLinkItem,
  MenuPopup as DropdownMenuContent,
  MenuPortal as DropdownMenuPortal,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub as DropdownMenuSub,
  MenuSubPopup as DropdownMenuSubContent,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuTrigger as DropdownMenuTrigger,
} from '@hrms/ui/components/menu';

/**
 * A heading for the whole popup.
 *
 * NOT coss `MenuGroupLabel`: that is Base UI's `Menu.GroupLabel`, which
 * throws unless it sits inside a `Menu.Group` because it exists to name that
 * group via aria-labelledby. Radix's `DropdownMenuLabel` was a standalone
 * heading, and every call site here uses it that way — directly under the
 * popup, labelling the menu rather than a group within it.
 *
 * Use `DropdownMenuGroupLabel` when there really is a group to name.
 */
export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & { inset?: boolean }): React.ReactElement {
  return (
    <div
      className={cn(
        'px-2 py-1.5 font-medium text-muted-foreground text-xs data-inset:ps-9 sm:data-inset:ps-8',
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}
