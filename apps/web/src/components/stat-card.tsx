'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import type { LucideIcon } from 'lucide-react';

export type StatGradient = 'primary' | 'sky' | 'emerald' | 'amber' | 'rose';

const GRADIENT: Record<StatGradient, string> = {
  primary: 'gradient-primary',
  sky: 'gradient-sky',
  emerald: 'gradient-emerald',
  amber: 'gradient-amber',
  rose: 'gradient-rose',
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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm text-white/85">{label}</p>
          {loading ? (
            <Skeleton className="mt-2 h-9 w-16 bg-white/25" />
          ) : (
            <p className="mt-1 font-bold text-3xl tabular-nums tracking-tight">{value ?? '—'}</p>
          )}
          {hint && <p className="mt-1 truncate text-white/75 text-xs">{hint}</p>}
        </div>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20">
          <Icon className="size-5" aria-hidden />
        </span>
      </div>
    </div>
  );
}
