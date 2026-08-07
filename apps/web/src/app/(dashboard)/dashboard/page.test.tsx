import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attendanceApi } from '@/features/attendance/api';
import { type DashboardSummary, dashboardApi } from '@/features/dashboard/api';
import { holidaysApi } from '@/features/organization/api';
import { render, screen } from '@/test/render';
import DashboardPage from './page';

const perms = new Set<string>();

vi.mock('@/components/session-provider', () => ({
  useSession: () => ({
    user: { id: 'u1', email: 'ada@example.com', firstName: 'Ada' },
    can: (p: string) => perms.has(p),
  }),
}));
vi.mock('@/features/dashboard/api', async () => {
  const actual = await vi.importActual<typeof import('@/features/dashboard/api')>(
    '@/features/dashboard/api',
  );
  return { ...actual, dashboardApi: { summary: vi.fn() } };
});
vi.mock('@/features/attendance/api', async () => {
  const actual = await vi.importActual<typeof import('@/features/attendance/api')>(
    '@/features/attendance/api',
  );
  return { ...actual, attendanceApi: { stats: vi.fn(), myMonth: vi.fn() } };
});
vi.mock('@/features/organization/api', () => ({ holidaysApi: { list: vi.fn() } }));

// Widgets with lives of their own; each is covered where it lives.
vi.mock('@/features/attendance/components/clock-card', () => ({ ClockCard: () => null }));
vi.mock('@/features/announcements/components/announcements-widget', () => ({
  AnnouncementsWidget: () => null,
}));
vi.mock('@/features/reports/components/headcount-widget', () => ({ HeadcountWidget: () => null }));

const summary = (over: Partial<DashboardSummary> = {}): DashboardSummary => ({
  today: '2026-08-06',
  headcount: null,
  onProbation: null,
  probationOverdue: null,
  exits: null,
  approvals: null,
  payroll: null,
  upcomingLastWorkingDates: [],
  celebrations: { birthdays: [], anniversaries: [] },
  me: {
    leave: { available: 15, byType: [{ name: 'Annual', available: 13 }] },
    requests: { total: 2, leave: 1, attendance: 0, remoteWork: 1 },
  },
  ...over,
});

beforeEach(() => {
  perms.clear();
  vi.mocked(dashboardApi.summary).mockReset().mockResolvedValue(summary());
  vi.mocked(attendanceApi.myMonth)
    .mockReset()
    .mockResolvedValue({
      month: '2026-08',
      timeZone: 'Asia/Kolkata',
      days: [],
      summary: {
        present: 18,
        absent: 1,
        halfDay: 0,
        onLeave: 2,
        holidays: 1,
        weekOffs: 4,
        lateMarks: 3,
        workedMinutes: 8_640,
      },
    });
  vi.mocked(attendanceApi.stats).mockReset();
  vi.mocked(holidaysApi.list)
    .mockReset()
    .mockResolvedValue({
      data: [],
      meta: { page: 1, limit: 50, total: 0 },
    });
});

describe('an employee', () => {
  /*
   * The complaint this answers: every tile on this page was an organizational
   * one, so the largest role in the product arrived at an empty row.
   */
  it('gets a row of their own figures where there were none', async () => {
    perms.add('attendance.read.own');

    render(<DashboardPage />);

    expect(await screen.findByText('Leave days left')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('Annual 13')).toBeInTheDocument();

    expect(screen.getByText('Your requests')).toBeInTheDocument();
    expect(screen.getByText('1 leave · 1 remote')).toBeInTheDocument();

    expect(await screen.findByText('Present this month')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
  });

  it('is not told about a leave type it has nothing left in', async () => {
    vi.mocked(dashboardApi.summary).mockResolvedValue(
      summary({
        me: {
          leave: { available: 0, byType: [{ name: 'Sick', available: 0 }] },
          requests: { total: 0, leave: 0, attendance: 0, remoteWork: 0 },
        },
      }),
    );
    render(<DashboardPage />);

    expect(await screen.findByText('Nothing left this year')).toBeInTheDocument();
    expect(screen.getByText('Nothing pending')).toBeInTheDocument();
  });

  /* No team to look at, so the month is their own — and it is asked for. */
  it('asks for its own month rather than the org’s day', async () => {
    perms.add('attendance.read.own');
    render(<DashboardPage />);

    await screen.findByText('Present this month');
    expect(attendanceApi.stats).not.toHaveBeenCalled();
    expect(attendanceApi.myMonth).toHaveBeenCalled();
  });
});

describe('somebody with a team', () => {
  /*
   * Their row is already a list of things waiting on them, and their own leave
   * balance is not the most urgent item on it.
   */
  it('keeps the organizational tiles and gains no personal ones', async () => {
    perms.add('leave.approve.team');
    vi.mocked(dashboardApi.summary).mockResolvedValue(
      summary({ approvals: { total: 4, leave: 4, attendance: 0, remoteWork: 0 } }),
    );
    render(<DashboardPage />);

    expect(await screen.findByText('Waiting on you')).toBeInTheDocument();
    expect(screen.queryByText('Leave days left')).not.toBeInTheDocument();
    expect(screen.queryByText('Your requests')).not.toBeInTheDocument();
  });
});

describe('an account with no employee record', () => {
  it('shows no personal tiles rather than a row of zeroes', async () => {
    vi.mocked(dashboardApi.summary).mockResolvedValue(summary({ me: null }));
    render(<DashboardPage />);

    // The page renders; the tile row simply has nothing in it.
    expect(await screen.findByText('Quick actions')).toBeInTheDocument();
    expect(screen.queryByText('Leave days left')).not.toBeInTheDocument();
  });
});
