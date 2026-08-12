'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';

/**
 * Eleven, because the dashboard can render eleven tiles at once and five meant
 * three of them appeared twice in one grid — which reads as a relationship
 * between two unrelated numbers rather than as decoration.
 *
 * `primary` follows the brand and therefore the theme; the other ten are
 * categorical and fixed. All ten measure ≥ 4.5:1 against white — see the note
 * in `globals.css`, including what that cost the original four.
 */
export type StatGradient =
  | 'primary'
  | 'sky'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'violet'
  | 'fuchsia'
  | 'lime'
  | 'slate'
  | 'stone';

const GRADIENT: Record<StatGradient, string> = {
  primary: 'gradient-primary',
  sky: 'gradient-sky',
  emerald: 'gradient-emerald',
  amber: 'gradient-amber',
  rose: 'gradient-rose',
  indigo: 'gradient-indigo',
  violet: 'gradient-violet',
  fuchsia: 'gradient-fuchsia',
  lime: 'gradient-lime',
  slate: 'gradient-slate',
  stone: 'gradient-stone',
};

interface StatCardProps {
  label: string;
  value: number | string | undefined;
  hint?: string;
  icon: LucideIcon;
  gradient: StatGradient;
  loading?: boolean;
}

/** Gradient stat tile (redesign brief §6) — white text on saturated bg, AA checked. */
export function StatCard({ label, value, hint, icon: Icon, gradient, loading }: StatCardProps) {
  return (
    <div
      className={cn(
        'hover-lift relative overflow-hidden rounded-2xl p-5 text-white shadow-lg',
        GRADIENT[gradient],
      )}
    >
      <div
        className="-right-6 -top-6 pointer-events-none absolute size-28 rounded-full bg-white/10"
        aria-hidden
      />
      {/*
       * Loading skeletons the whole tile, not just the figure.
       *
       * It used to replace only the number, which left a finished-looking card
       * — real label, real hint, real icon — with one grey bar in the middle of
       * it. That reads as a card that failed rather than a card that is
       * loading, and eleven of them at once on the dashboard made it worse.
       *
       * The gradient stays. The bars are white/25 on top of it, so the grid
       * keeps its colour while it waits and nothing moves when the data lands
       * — every placeholder occupies the box its real content will.
       */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {loading ? (
            <Skeleton className="h-5 w-24 bg-white/25" />
          ) : (
            <p className="font-medium text-sm text-white/85">{label}</p>
          )}

          {loading ? (
            <Skeleton className="mt-2 h-9 w-16 bg-white/25" />
          ) : (
            <p className="mt-1 font-bold text-3xl tabular-nums tracking-tight">{value ?? '—'}</p>
          )}

          {/*
           * A hint only exists on some tiles, so its placeholder follows the
           * same rule — skeletoning a line that will never arrive would leave
           * the card taller while loading than after.
           */}
          {loading
            ? hint !== undefined && <Skeleton className="mt-2 h-3.5 w-32 bg-white/25" />
            : hint && <p className="mt-1 truncate text-white/75 text-xs">{hint}</p>}
        </div>

        {loading ? (
          <Skeleton className="size-10 shrink-0 rounded-xl bg-white/20" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
            <Icon className="size-5" aria-hidden />
          </span>
        )}
      </div>
    </div>
  );
}
