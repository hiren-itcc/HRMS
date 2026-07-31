'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import type { LeaveBalance } from '../api';

const RING = ['stroke-chart-1', 'stroke-chart-2', 'stroke-chart-3', 'stroke-chart-4'];

/** Balance tile with a progress ring — used vs. entitled. */
export function BalanceCard({ balance, index }: { balance: LeaveBalance; index: number }) {
  const reduce = useReducedMotion();
  const entitled = balance.allocated + balance.carriedOver;
  const pct = entitled > 0 ? Math.min(100, (balance.used / entitled) * 100) : 0;
  const radius = 26;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="hover-lift flex items-center gap-4 rounded-2xl border bg-card p-4">
      <div className="relative shrink-0">
        {/* Decorative: the same figures are in the text beside it */}
        <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden="true" className="-rotate-90">
          <circle cx="34" cy="34" r={radius} fill="none" strokeWidth="6" className="stroke-muted" />
          <motion.circle
            cx="34"
            cy="34"
            r={radius}
            fill="none"
            strokeWidth="6"
            strokeLinecap="round"
            className={cn(RING[index % RING.length])}
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: circumference - (pct / 100) * circumference }}
            transition={reduce ? { duration: 0 } : { duration: 0.6, ease: 'easeOut' }}
          />
        </svg>
        <span className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-bold text-base tabular-nums leading-none">{balance.available}</span>
          <span className="text-[10px] text-muted-foreground">left</span>
        </span>
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium text-sm">{balance.leaveType?.name ?? 'Leave'}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {balance.used} used of {entitled}
          {balance.carriedOver > 0 && ` (incl. ${balance.carriedOver} carried)`}
        </p>
        {balance.leaveType && !balance.leaveType.isPaid && (
          <p className="text-muted-foreground text-xs">Unpaid</p>
        )}
      </div>
    </div>
  );
}
