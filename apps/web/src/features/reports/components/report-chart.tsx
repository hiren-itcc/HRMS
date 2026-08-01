'use client';

import type { ReportChart as ReportChartData } from '@hrms/shared';
import { useReducedMotion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/**
 * The single place Recharts is imported, so the charting rules are enforced
 * once instead of being re-remembered on every page:
 *
 * - Colour comes from `--chart-1..5` by **series index**, never by rank, so
 *   filtering a series never repaints the survivors. The tokens are validated
 *   for CVD separation and carry their own dark-mode steps, which is also why
 *   they are read as CSS variables — the theme switches with no JS and no
 *   hydration mismatch.
 * - A legend appears for two or more series; identity is never colour alone.
 * - Direct labels only on small datasets — a number on every one of 300 bars
 *   is noise, not information.
 * - One y-axis. Never two.
 */

const SLOTS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];

/** Beyond this the axis is unreadable and labels collide, so they are dropped. */
const MAX_DIRECT_LABELS = 12;
const MAX_AXIS_TICKS = 16;

const AXIS = {
  stroke: 'var(--border)',
  tick: { fill: 'var(--muted-foreground)', fontSize: 11 },
  tickLine: false,
} as const;

function TooltipBox({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number | string; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-card/95 px-3 py-2 text-sm shadow-lg backdrop-blur">
      <p className="mb-1 font-medium text-foreground text-xs">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="flex items-center gap-2 text-muted-foreground text-xs">
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full"
            style={{ background: entry.color }}
          />
          <span>{entry.name}</span>
          <span className="ml-auto font-medium text-foreground tabular-nums">{entry.value}</span>
        </p>
      ))}
    </div>
  );
}

interface ReportChartProps {
  chart: ReportChartData;
  height?: number;
}

export function ReportChart({ chart, height = 280 }: ReportChartProps) {
  const reduceMotion = useReducedMotion();
  const animate = !reduceMotion;
  const showLegend = chart.series.length >= 2;
  const showLabels = chart.series.length <= 2 && chart.data.length <= MAX_DIRECT_LABELS;
  const horizontal = chart.kind === 'horizontalBar';

  const empty = chart.data.length === 0 || chart.data.every((row) => rowTotal(row, chart) === 0);

  return (
    <section className="rounded-2xl border bg-card p-5 shadow-xs break-inside-avoid">
      <h3 className="font-semibold text-sm tracking-tight">{chart.title}</h3>

      {empty ? (
        <p className="flex items-center justify-center py-12 text-muted-foreground text-sm">
          No data in this range
        </p>
      ) : (
        <div
          className="mt-4"
          style={{ height: horizontal ? barHeight(chart.data.length) : height }}
        >
          <ResponsiveContainer width="100%" height="100%">
            {chart.kind === 'line' ? (
              <LineChart data={chart.data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey={chart.xKey} interval="preserveStartEnd" minTickGap={24} {...AXIS} />
                <YAxis allowDecimals={false} width={44} {...AXIS} />
                <Tooltip content={<TooltipBox />} cursor={{ stroke: 'var(--border)' }} />
                {showLegend && <Legend {...LEGEND} />}
                {chart.series.map((s, i) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={SLOTS[i % SLOTS.length]}
                    strokeWidth={2}
                    dot={chart.data.length <= MAX_AXIS_TICKS ? { r: 4 } : false}
                    activeDot={{ r: 6 }}
                    isAnimationActive={animate}
                  />
                ))}
              </LineChart>
            ) : (
              <BarChart
                data={chart.data}
                layout={horizontal ? 'vertical' : 'horizontal'}
                margin={{ top: 8, right: 16, left: horizontal ? 8 : -16, bottom: 0 }}
                barCategoryGap={horizontal ? '25%' : '20%'}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={horizontal}
                  horizontal={!horizontal}
                />
                {horizontal ? (
                  <>
                    <XAxis type="number" allowDecimals={false} {...AXIS} />
                    <YAxis
                      type="category"
                      dataKey={chart.xKey}
                      width={124}
                      tickFormatter={truncate}
                      {...AXIS}
                    />
                  </>
                ) : (
                  <>
                    <XAxis
                      dataKey={chart.xKey}
                      interval="preserveStartEnd"
                      minTickGap={16}
                      {...AXIS}
                    />
                    <YAxis allowDecimals={false} width={44} {...AXIS} />
                  </>
                )}
                <Tooltip content={<TooltipBox />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
                {showLegend && <Legend {...LEGEND} />}
                {chart.series.map((s, i) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    name={s.label}
                    // A 2px surface gap keeps stacked segments legible where
                    // two fills meet.
                    stackId={chart.kind === 'stackedBar' ? 'stack' : undefined}
                    stroke="var(--card)"
                    strokeWidth={chart.kind === 'stackedBar' ? 2 : 0}
                    fill={SLOTS[i % SLOTS.length]}
                    radius={radiusFor(chart.kind, horizontal)}
                    isAnimationActive={animate}
                    maxBarSize={horizontal ? 22 : 48}
                  >
                    {showLabels && (
                      <LabelList
                        dataKey={s.key}
                        position={horizontal ? 'right' : 'top'}
                        className="fill-muted-foreground"
                        fontSize={11}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

const LEGEND = {
  verticalAlign: 'bottom' as const,
  height: 28,
  iconType: 'circle' as const,
  iconSize: 8,
  wrapperStyle: { fontSize: 12, color: 'var(--muted-foreground)' },
};

/** Rounded data-end only, anchored to the baseline. */
function radiusFor(
  kind: ReportChartData['kind'],
  horizontal: boolean,
): [number, number, number, number] {
  if (kind === 'stackedBar') return [0, 0, 0, 0];
  return horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
}

/** Horizontal bars grow with the category count instead of squeezing. */
function barHeight(count: number): number {
  return Math.max(180, Math.min(520, count * 34 + 60));
}

function truncate(value: string): string {
  return value.length > 16 ? `${value.slice(0, 15)}…` : value;
}

function rowTotal(row: Record<string, string | number>, chart: ReportChartData): number {
  return chart.series.reduce((sum, s) => sum + (Number(row[s.key]) || 0), 0);
}
