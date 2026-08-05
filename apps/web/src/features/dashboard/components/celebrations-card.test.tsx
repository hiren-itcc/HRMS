import { describe, expect, it } from 'vitest';
import { render, screen } from '@/test/render';
import type { DashboardSummary } from '../api';
import { CelebrationsCard } from './celebrations-card';

const celebrations = (
  over: Partial<DashboardSummary['celebrations']> = {},
): DashboardSummary['celebrations'] => ({
  birthdays: [],
  anniversaries: [],
  ...over,
});

const person = (over: object = {}) => ({
  id: 'e1',
  name: 'Ada Lovelace',
  avatarUrl: null,
  monthDay: '08-20',
  inDays: 15,
  ...over,
});

describe('CelebrationsCard', () => {
  it('reads a month-day as a date, with no year anywhere', () => {
    render(
      <CelebrationsCard celebrations={celebrations({ birthdays: [person()] })} loading={false} />,
    );

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('20 Aug')).toBeInTheDocument();
  });

  /* "in 0 days" is not how anybody says it. */
  it('says today and tomorrow rather than counting to zero', () => {
    render(
      <CelebrationsCard
        celebrations={celebrations({
          birthdays: [person({ id: 'a', inDays: 0 }), person({ id: 'b', inDays: 1 })],
        })}
        loading={false}
      />,
    );

    expect(screen.getByText('today')).toBeInTheDocument();
    expect(screen.getByText('tomorrow')).toBeInTheDocument();
  });

  /* An anniversary is about the count of years — that is the whole substance. */
  it('shows the years on an anniversary and pluralises them', () => {
    render(
      <CelebrationsCard
        celebrations={celebrations({
          anniversaries: [
            { ...person({ id: 'one' }), years: 1 },
            { ...person({ id: 'many' }), years: 5 },
          ],
        })}
        loading={false}
      />,
    );

    expect(screen.getByText(/1 year$/)).toBeInTheDocument();
    expect(screen.getByText(/5 years$/)).toBeInTheDocument();
  });

  /*
   * 29 February must format rather than roll into 1 March — the year used to
   * parse it is a leap year for exactly this reason.
   */
  it('formats a leap day', () => {
    render(
      <CelebrationsCard
        celebrations={celebrations({ birthdays: [person({ monthDay: '02-29', inDays: 20 })] })}
        loading={false}
      />,
    );

    expect(screen.getByText('29 Feb')).toBeInTheDocument();
  });

  /* An empty card that renders nothing looks like a bug. */
  it('says when there is nothing coming up', () => {
    render(<CelebrationsCard celebrations={celebrations()} loading={false} />);
    expect(screen.getByText(/nothing coming up/i)).toBeInTheDocument();
  });

  it('shows no empty message while it is still loading', () => {
    render(<CelebrationsCard celebrations={undefined} loading />);
    expect(screen.queryByText(/nothing coming up/i)).not.toBeInTheDocument();
  });
});
