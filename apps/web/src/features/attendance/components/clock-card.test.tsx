import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@/test/render';
import type { DayEntry, TodayState } from '../api';
import { attendanceApi, getPosition } from '../api';
import { ClockCard } from './clock-card';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    getPosition: vi.fn(),
    attendanceApi: { today: vi.fn(), checkIn: vi.fn(), checkOut: vi.fn() },
  };
});

/** A promise this test decides when to settle, standing in for a slow request. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const today = (over: Partial<TodayState> = {}): TodayState =>
  ({
    date: '2026-08-06',
    status: 'NOT_MARKED',
    checkIn: null,
    checkOut: null,
    workMinutes: null,
    isLate: false,
    note: null,
    workMode: null,
    remoteApproved: null,
    sessions: [],
    timeZone: 'Asia/Kolkata',
    shift: null,
    serverTime: '2026-08-06T04:00:00.000Z',
    ...over,
  }) as TodayState;

const entry = (over: Partial<DayEntry> = {}) => ({ ...today(), ...over }) as DayEntry;

/** The spinner is aria-hidden, so it is found the way a person sees it. */
const spinner = () => document.querySelector('svg.animate-spin');

beforeEach(() => {
  vi.mocked(getPosition).mockReset().mockResolvedValue({ status: 'unavailable' });
  vi.mocked(attendanceApi.today).mockReset().mockResolvedValue(today());
  vi.mocked(attendanceApi.checkIn).mockReset().mockResolvedValue(entry());
  vi.mocked(attendanceApi.checkOut).mockReset().mockResolvedValue(entry());
});

describe('while a punch is in flight', () => {
  /*
   * The wait is longer than an ordinary form's: the browser may be asking for
   * a location before the request is even sent. Without a spinner the button
   * looks ignored, and the natural response to that is to press it again.
   */
  it('spins the button and refuses a second press', async () => {
    const inFlight = deferred<DayEntry>();
    vi.mocked(attendanceApi.checkIn).mockReturnValue(inFlight.promise);
    render(<ClockCard />);

    const button = await screen.findByRole('button', { name: /clock in/i });
    await userEvent.click(button);

    await waitFor(() => expect(spinner()).toBeInTheDocument());
    expect(button).toBeDisabled();

    inFlight.resolve(entry());
    await waitFor(() => expect(spinner()).not.toBeInTheDocument());
  });

  /*
   * The punch landing is not the same moment as the card being able to say so.
   * If the spinner stopped when the POST resolved, the button would read
   * "Clock in" again for as long as the refetch takes — an invitation to punch
   * twice, seconds after the first one worked.
   */
  it('keeps spinning until the card can say you are in', async () => {
    const refetched = deferred<TodayState>();
    vi.mocked(attendanceApi.today)
      .mockResolvedValueOnce(today())
      .mockReturnValueOnce(refetched.promise);
    render(<ClockCard />);

    const button = await screen.findByRole('button', { name: /clock in/i });
    await userEvent.click(button);

    // The POST has resolved by now; only the refetch is outstanding.
    await waitFor(() => expect(attendanceApi.checkIn).toHaveBeenCalled());
    expect(spinner()).toBeInTheDocument();
    expect(button).toBeDisabled();

    refetched.resolve(
      today({
        status: 'PRESENT',
        checkIn: '2026-08-06T04:00:00.000Z',
        sessions: [
          {
            id: 's1',
            checkIn: '2026-08-06T04:00:00.000Z',
            checkOut: null,
            workMode: 'OFFICE',
            verification: 'UNVERIFIED',
            distanceMeters: null,
            officeName: null,
          },
        ],
      }),
    );

    expect(await screen.findByRole('button', { name: /clock out/i })).toBeEnabled();
    expect(spinner()).not.toBeInTheDocument();
  });
});
