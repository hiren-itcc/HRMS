'use client';

import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { cn } from '@hrms/ui/lib/utils';
import { rangePresets } from '../api';

interface DateRangeFilterProps {
  from: string;
  to: string;
  /**
   * Both keys are written in one call — writing them separately would build
   * the second URL from stale params and drop the first.
   */
  onChange: (range: { from: string; to: string }) => void;
}

export function DateRangeFilter({ from, to, onChange }: DateRangeFilterProps) {
  const presets = rangePresets();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          value={from}
          max={to}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to })}
          className="w-40"
          aria-label="Report start date"
        />
        <span className="text-muted-foreground text-sm" aria-hidden>
          →
        </span>
        <Input
          type="date"
          value={to}
          min={from}
          onChange={(e) => e.target.value && onChange({ from, to: e.target.value })}
          className="w-40"
          aria-label="Report end date"
        />
      </div>

      <div className="flex flex-wrap gap-1">
        {presets.map((preset) => {
          const active = preset.from === from && preset.to === to;
          return (
            <Button
              key={preset.label}
              type="button"
              size="sm"
              variant={active ? 'secondary' : 'ghost'}
              aria-pressed={active}
              className={cn('h-8 text-xs', active && 'font-medium')}
              onClick={() => onChange({ from: preset.from, to: preset.to })}
            >
              {preset.label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}
