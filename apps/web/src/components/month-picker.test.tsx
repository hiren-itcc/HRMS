import { formatDisplayMonth, MonthPicker, parseISOMonth } from '@hrms/ui/components/month-picker';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';

/**
 * The month field that replaced `<input type="month">`.
 *
 * Tested from `apps/web` rather than `packages/ui` because that is where the
 * test runner and the jsdom setup live; the UI package ships no harness of its
 * own.
 */

function Harness({ initial = '', max }: { initial?: string; max?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <MonthPicker value={value} max={max} onValueChange={setValue} aria-label="Month" />
      <output>{value}</output>
    </>
  );
}

describe('parsing and display', () => {
  it('reads a yyyy-mm string', () => {
    expect(parseISOMonth('2026-08')).toEqual({ year: 2026, month: 8 });
  });

  /* A full date is not a month, and neither is a 13th one. */
  it('rejects anything that is not a month', () => {
    expect(parseISOMonth('2026-08-01')).toBeUndefined();
    expect(parseISOMonth('2026-13')).toBeUndefined();
    expect(parseISOMonth('')).toBeUndefined();
    expect(parseISOMonth(null)).toBeUndefined();
  });

  /*
   * Named and fixed. `2026-08` is not a thing to show somebody, and a
   * locale-dependent format would differ between the server and the browser —
   * which is a hydration mismatch.
   */
  it('shows a named month and year', () => {
    expect(formatDisplayMonth('2026-08')).toBe('August 2026');
  });
});

describe('picking', () => {
  it('shows the placeholder until something is chosen', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /Month/ })).toHaveTextContent('Pick a month');
  });

  it('writes back a yyyy-mm string', async () => {
    render(<Harness initial="2026-08" />);

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'March 2026' }));

    expect(screen.getByRole('button', { name: /Month/ })).toHaveTextContent('March 2026');
  });

  /*
   * The reason `max` exists on both call sites: payroll cannot be opened for a
   * month that has not happened, and attendance has nothing to show for one.
   */
  it('refuses a month past the maximum', async () => {
    render(<Harness initial="2026-08" max="2026-08" />);

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    expect(await screen.findByRole('button', { name: 'September 2026' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'July 2026' })).toBeEnabled();
  });

  /* A year with nothing selectable in it is a dead end, so you cannot walk to it. */
  it('will not step to a year the maximum excludes', async () => {
    render(<Harness initial="2026-08" max="2026-12" />);

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    expect(await screen.findByRole('button', { name: 'Show 2027' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Show 2025' })).toBeEnabled();
  });

  it('steps the year and picks from it', async () => {
    render(<Harness initial="2026-08" />);

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show 2025' }));
    await userEvent.click(await screen.findByRole('button', { name: 'December 2025' }));

    expect(screen.getByRole('button', { name: /Month/ })).toHaveTextContent('December 2025');
  });

  /*
   * Re-opening lands on the chosen month rather than wherever the last browse
   * was abandoned — otherwise the grid quietly disagrees with the trigger.
   */
  it('returns to the selected year when reopened', async () => {
    render(<Harness initial="2026-08" />);

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Show 2025' }));
    await userEvent.keyboard('{Escape}');

    await userEvent.click(screen.getByRole('button', { name: /Month/ }));
    expect(await screen.findByRole('button', { name: 'August 2026' })).toBeInTheDocument();
  });
});
