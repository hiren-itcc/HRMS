'use client';

import { cn } from '@hrms/ui/lib/utils';
import { motion, useReducedMotion } from 'framer-motion';
import type { DayEntry } from '../api';
import { STATUS_STYLE } from './status-badge';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Monday-first column index for a YYYY-MM-DD key. */
function mondayIndex(dateKey: string): number {
  return (new Date(`${dateKey}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

const LEGEND: (keyof typeof STATUS_STYLE)[] = [
  'PRESENT',
  'HALF_DAY',
  'ABSENT',
  'HOLIDAY',
  'WEEK_OFF',
];

interface CalendarProps {
  days: DayEntry[];
  selected?: string;
  onSelect: (day: DayEntry) => void;
}

export function AttendanceCalendar({ days, selected, onSelect }: CalendarProps) {
  const reduceMotion = useReducedMotion();
  const lead = days.length ? mondayIndex(days[0]?.date ?? '') : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((d) => (
          <div key={d} className="pb-1 text-muted-foreground text-xs uppercase tracking-wider">
            {d.slice(0, 1)}
            <span className="hidden sm:inline">{d.slice(1)}</span>
          </div>
        ))}

        {Array.from({ length: lead }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed leading blanks
          <div key={`lead-${i}`} aria-hidden />
        ))}

        {days.map((day, i) => {
          const style = STATUS_STYLE[day.status];
          const isSelected = selected === day.date;
          const dayNumber = Number(day.date.slice(8));
          return (
            <motion.button
              key={day.date}
              type="button"
              onClick={() => onSelect(day)}
              aria-label={`${day.date} — ${style.label}`}
              aria-pressed={isSelected}
              initial={reduceMotion ? false : { opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.18, delay: reduceMotion ? 0 : Math.min(i * 0.008, 0.25) }}
              className={cn(
                'flex aspect-square min-h-11 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border text-sm transition-colors',
                day.status === 'FUTURE'
                  ? 'border-dashed text-muted-foreground/50'
                  : 'hover:border-primary/50 hover:bg-accent',
                isSelected && 'border-primary ring-2 ring-ring/40',
              )}
            >
              <span className="font-medium tabular-nums">{dayNumber}</span>
              <span className="flex items-center gap-0.5">
                <span className={cn('size-1.5 rounded-full', style.dot)} aria-hidden />
                {day.isLate && <span className="size-1.5 rounded-full bg-warning" aria-hidden />}
              </span>
            </motion.button>
          );
        })}
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
        {LEGEND.map((key) => (
          <li key={key} className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span className={cn('size-2 rounded-full', STATUS_STYLE[key].dot)} aria-hidden />
            {STATUS_STYLE[key].label}
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span className="size-2 rounded-full bg-warning" aria-hidden /> Late mark
        </li>
      </ul>
    </div>
  );
}
