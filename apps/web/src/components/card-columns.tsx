'use client';

import { cn } from '@hrms/ui/lib/utils';
import { Children, type ReactNode } from 'react';

/**
 * Two columns of cards, packed rather than aligned.
 *
 * A CSS grid makes every row as tall as its tallest cell, so a short card
 * beside a tall one leaves a hole underneath it — 150 pixels of nothing
 * between Contact and Employment lifecycle on the employee record. Nothing
 * fills that hole; it is simply the grid keeping rows level, which matters for
 * a table and not at all for a column of independent cards.
 *
 * Each column here is a plain vertical stack, so the only vertical space
 * between two cards is the gap.
 *
 * **Dealing alternately puts every card exactly where the grid put it.** A
 * two-column grid places children row-major — first left, second right, third
 * left — which is the same as evens-left, odds-right. Nothing moves sideways;
 * the row-height coupling is the only thing that goes. The two columns end at
 * different heights, which is the point.
 *
 * `Children.toArray` drops the `false` that `{cond && <Card/>}` yields, so a
 * card that is not rendered does not take a slot — matching how the grid
 * skipped it. A card that renders but returns null is handled by
 * `FadeInItem`'s `empty:hidden`, since a hidden element is not a flex item
 * and so contributes no gap.
 */
export function CardColumns({ children, className }: { children: ReactNode; className?: string }) {
  const items = Children.toArray(children);
  const left = items.filter((_, i) => i % 2 === 0);
  const right = items.filter((_, i) => i % 2 === 1);

  return (
    <div className={cn('grid items-start gap-6 lg:grid-cols-2', className)}>
      <div className="flex flex-col gap-6">{left}</div>
      {right.length > 0 && <div className="flex flex-col gap-6">{right}</div>}
    </div>
  );
}
