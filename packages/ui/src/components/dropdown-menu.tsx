'use client';

/*
 * coss names this primitive `Menu`; we had it as `DropdownMenu` across ~15
 * screens. Rather than rename every call site for no behavioural gain, this
 * file is an alias layer — the implementation is coss `menu.tsx`, unchanged.
 *
 * The one real API shift call sites do have to make is Radix's `onSelect`,
 * which Base UI spells `onClick`.
 */

export {
  Menu as DropdownMenu,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuCreateHandle as DropdownMenuCreateHandle,
  MenuGroup as DropdownMenuGroup,
  MenuGroupLabel as DropdownMenuLabel,
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
