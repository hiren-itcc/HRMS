'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@hrms/ui/lib/utils';
import type React from 'react';

export type TabsVariant = 'default' | 'underline';

export function Tabs({ className, ...props }: TabsPrimitive.Root.Props): React.ReactElement {
  return (
    <TabsPrimitive.Root
      className={cn('flex flex-col gap-2 data-[orientation=vertical]:flex-row', className)}
      data-slot="tabs"
      {...props}
    />
  );
}

export function TabsList({
  variant = 'default',
  className,
  children,
  ...props
}: TabsPrimitive.List.Props & {
  variant?: TabsVariant;
}): React.ReactElement {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative z-0 flex w-fit items-center justify-center gap-x-0.5 text-muted-foreground',
        /*
         * `self-start` so a vertical rail is only as tall as its tabs. Without
         * it the list is a stretched flex child of the row, matching the height
         * of whatever panel sits beside it — which leaves a tall invisible
         * hit area below the last tab and gives the indicator a taller box
         * than the tabs it is tracking.
         */
        'data-[orientation=vertical]:flex-col data-[orientation=vertical]:self-start',
        variant === 'default'
          ? 'rounded-lg bg-muted p-0.5 text-muted-foreground/72'
          : 'data-[orientation=vertical]:px-1 data-[orientation=horizontal]:py-1 *:data-[slot=tabs-tab]:hover:bg-accent',
        className,
      )}
      data-slot="tabs-list"
      {...props}
    >
      {children}
      <TabsPrimitive.Indicator
        className={cn(
          'absolute bottom-0 left-0 h-(--active-tab-height) w-(--active-tab-width) translate-x-(--active-tab-left) -translate-y-(--active-tab-bottom) transition-[width,translate] duration-200 ease-in-out',
          variant === 'underline'
            ? 'z-10 bg-primary data-[orientation=horizontal]:h-0.5 data-[orientation=vertical]:w-0.5 data-[orientation=vertical]:-translate-x-px data-[orientation=horizontal]:translate-y-px'
            : '-z-1 rounded-md bg-background shadow-sm/5 dark:bg-input',
        )}
        data-slot="tab-indicator"
      />
    </TabsPrimitive.List>
  );
}

export function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props): React.ReactElement {
  return (
    <TabsPrimitive.Tab
      className={cn(
        /*
         * `grow` is right for a horizontal bar, where tabs share the row
         * evenly — and wrong the moment the list turns vertical, because the
         * main axis becomes the height and every tab stretches to fill the
         * panel beside it. `data-[orientation=vertical]:grow-0` keeps each
         * tab at its own `h-9`. The sibling `w-full` and `justify-start`
         * overrides below were already here; this one was missed because
         * nothing used a vertical rail until the preferences screen did.
         */
        "relative flex h-9 shrink-0 grow cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent px-[calc(--spacing(2.5)-1px)] font-medium text-base outline-none transition-[color,background-color,box-shadow] hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-[orientation=vertical]:w-full data-[orientation=vertical]:grow-0 data-[orientation=vertical]:justify-start data-active:text-foreground data-disabled:opacity-64 sm:h-8 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0",
        className,
      )}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

export function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props): React.ReactElement {
  return (
    <TabsPrimitive.Panel
      className={cn('flex-1 outline-none', className)}
      data-slot="tabs-content"
      {...props}
    />
  );
}

export { TabsPanel as TabsContent, TabsPrimitive, TabsTab as TabsTrigger };
