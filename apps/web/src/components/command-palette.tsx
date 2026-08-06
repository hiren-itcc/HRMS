'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from '@hrms/ui/components/command';
import { Kbd } from '@hrms/ui/components/kbd';
import type { LucideIcon } from 'lucide-react';
import { LogOut, Moon, Search, Sun } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { IconAction } from '@/components/icon-action';
import { NAV_ITEMS } from '@/components/nav-items';
import { useSession } from '@/components/session-provider';
import { useOrgSettings } from '@/features/settings/api';

interface Action {
  value: string;
  label: string;
  group: 'Go to' | 'Actions';
  icon: LucideIcon;
  run: () => void;
}

/**
 * ⌘K palette — the app never had a way to get anywhere without walking the
 * sidebar. Entries are built from the same NAV_ITEMS the sidebar uses and
 * filtered through the same permission and module checks, so the palette can
 * never offer a route the person would be bounced out of.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { can, logout } = useSession();
  const settings = useOrgSettings();
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // `key` is optional on KeyboardEvent: IME composition, autofill and
      // extension-dispatched events all reach this listener without one.
      if (event.key?.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const modules = settings.data?.modules;
  const actions = useMemo<Action[]>(() => {
    const go = NAV_ITEMS.filter(
      (item) =>
        !item.soon &&
        (!item.perms || item.perms.some((p) => can(p))) &&
        (!item.module || modules === undefined || modules[item.module]),
    ).map<Action>((item) => ({
      value: `go:${item.href}`,
      label: item.label,
      group: 'Go to',
      icon: item.icon,
      run: () => router.push(item.href),
    }));

    const dark = resolvedTheme === 'dark';
    return [
      ...go,
      {
        value: 'theme',
        label: dark ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'Actions',
        icon: dark ? Sun : Moon,
        run: () => setTheme(dark ? 'light' : 'dark'),
      },
      {
        value: 'signout',
        label: 'Sign out',
        group: 'Actions',
        icon: LogOut,
        run: () => {
          void logout().then(() => router.replace('/login'));
        },
      },
    ];
  }, [can, modules, resolvedTheme, setTheme, router, logout]);

  /*
   * Items are the label strings, not the action objects. coss types `Command`
   * as React.ComponentProps<typeof Autocomplete>, which erases Base UI's item
   * generic to `unknown`, and Base UI omits `itemToStringLabel` from
   * Autocomplete entirely — so object items would neither infer nor filter.
   * Strings filter natively; the label maps back to its action here.
   */
  const byLabel = useMemo(
    () => new Map(actions.map((action) => [action.label, action])),
    [actions],
  );
  const groups = (['Go to', 'Actions'] as const).map((group) => ({
    group,
    labels: actions.filter((action) => action.group === group).map((action) => action.label),
  }));

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        // Not a real input: it opens a dialog. Styled like a search field
        // because that is what it does, but it stays a button so the
        // accessible role matches the behaviour.
        className="hidden h-9 w-56 justify-start gap-2 px-3 text-muted-foreground font-normal md:inline-flex"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Search…</span>
        <Kbd>⌘K</Kbd>
      </Button>

      {/* Icon-only below md, where a 224px field would crowd out the brand */}
      <IconAction
        label="Search"
        icon={Search}
        size="icon"
        className="md:hidden"
        onClick={() => setOpen(true)}
      />

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandDialogPopup>
          <Command items={groups.map((g) => ({ items: g.labels }))}>
            <CommandInput placeholder="Jump to a section or run a command…" />
            <CommandEmpty>Nothing matches that.</CommandEmpty>
            <CommandList>
              {groups.map(({ group, labels }) => (
                <CommandGroup key={group} items={labels}>
                  <CommandGroupLabel>{group}</CommandGroupLabel>
                  <CommandCollection>
                    {(label: string) => {
                      const action = byLabel.get(label);
                      if (!action) return null;
                      return (
                        <CommandItem
                          key={label}
                          value={label}
                          onClick={() => {
                            setOpen(false);
                            action.run();
                          }}
                        >
                          <action.icon className="size-4 opacity-70" aria-hidden />
                          {label}
                        </CommandItem>
                      );
                    }}
                  </CommandCollection>
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}
