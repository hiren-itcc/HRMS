import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import type { Settlement } from '../api';
import { settlementsApi } from '../api';
import { SettlementCard } from './settlement-card';

const perms = new Set<string>();

vi.mock('@/components/session-provider', () => ({
  useSession: () => ({ can: (p: string) => perms.has(p) }),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return {
    ...actual,
    settlementsApi: { forOffboarding: vi.fn(), create: vi.fn() },
  };
});

const settlement = (over: Partial<Settlement> = {}) =>
  ({
    id: 's1',
    status: 'DRAFT',
    netPayable: 229_000,
    employee: { id: 'e1', firstName: 'Ada', lastName: 'Lovelace' },
    lines: [],
    ...over,
  }) as Settlement;

beforeEach(() => {
  perms.clear();
  vi.mocked(settlementsApi.forOffboarding).mockReset().mockResolvedValue(null);
});

describe('SettlementCard', () => {
  /*
   * The leak this card exists to avoid. Every HR user can open an exit page;
   * only somebody with a payroll read should see what the leaver is being
   * paid — and the card must not even ask the API on their behalf.
   */
  it('shows nothing at all without a payroll read', () => {
    render(<SettlementCard offboardingId="off1" />);

    expect(screen.queryByText(/full & final settlement/i)).not.toBeInTheDocument();
    expect(settlementsApi.forOffboarding).not.toHaveBeenCalled();
  });

  it('offers to prepare one when the exit has none', async () => {
    perms.add('payroll.read').add('payroll.process');
    render(<SettlementCard offboardingId="off1" />);

    expect(await screen.findByRole('button', { name: /prepare settlement/i })).toBeInTheDocument();
  });

  /* Reading a payout and computing one are different jobs. */
  it('does not offer to prepare one to somebody who may only read', async () => {
    perms.add('payroll.read');
    render(<SettlementCard offboardingId="off1" />);

    expect(await screen.findByText(/nothing has been computed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /prepare settlement/i })).not.toBeInTheDocument();
  });

  it('shows the net and a way through to the statement', async () => {
    perms.add('payroll.read');
    vi.mocked(settlementsApi.forOffboarding).mockResolvedValue(settlement());
    render(<SettlementCard offboardingId="off1" />);

    // To the paisa, matching the statement — see `formatSettlementMoney`.
    expect(await screen.findByText('₹2,29,000.00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open statement/i })).toHaveAttribute(
      'href',
      '/payroll/settlements/s1',
    );
  });

  /*
   * A negative net is a real outcome — notice recovery can exceed what
   * somebody is owed — and reading it as a payout would be exactly backwards.
   */
  it('says so when the money is owed the other way', async () => {
    perms.add('payroll.read');
    vi.mocked(settlementsApi.forOffboarding).mockResolvedValue(settlement({ netPayable: -38_200 }));
    render(<SettlementCard offboardingId="off1" />);

    expect(await screen.findByText(/this is due back/i)).toBeInTheDocument();
  });
});
