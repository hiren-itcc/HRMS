import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@/test/render';
import type { HeldAsset } from '../api';
import { assetsApi } from '../api';
import { EmployeeAssetsCard } from './employee-assets-card';
import { MyAssetsCard } from './my-assets-card';

const perms = new Set<string>();

vi.mock('@/components/session-provider', () => ({
  useSession: () => ({ can: (p: string) => perms.has(p) }),
}));
vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api');
  return { ...actual, assetsApi: { mine: vi.fn(), heldBy: vi.fn() } };
});

const held = (over: Partial<HeldAsset> = {}) =>
  ({
    id: 'as1',
    issuedOn: '2026-08-01',
    conditionOut: 'GOOD',
    notes: null,
    asset: {
      id: 'a1',
      assetTag: 'MAC-0042',
      name: 'MacBook Pro 14',
      serialNumber: 'SN-4471',
      category: { id: 'c1', name: 'Laptop' },
    },
    ...over,
  }) as HeldAsset;

beforeEach(() => {
  perms.clear();
  vi.mocked(assetsApi.mine).mockReset().mockResolvedValue([]);
  vi.mocked(assetsApi.heldBy).mockReset().mockResolvedValue([]);
});

describe('MyAssetsCard', () => {
  it('lists what somebody is holding, by tag', async () => {
    perms.add('asset.read.own');
    vi.mocked(assetsApi.mine).mockResolvedValue([held()]);
    render(<MyAssetsCard />);

    expect(await screen.findByText('MAC-0042')).toBeInTheDocument();
    expect(screen.getByText(/SN-4471/)).toBeInTheDocument();
  });

  /*
   * "Nothing is issued to you" is an answer worth reading before your last
   * day — an empty card that renders nothing would look like a bug.
   */
  it('says so when nothing is issued, rather than showing an empty card', async () => {
    perms.add('asset.read.own');
    render(<MyAssetsCard />);
    expect(await screen.findByText('Nothing is issued to you.')).toBeInTheDocument();
  });

  /*
   * They hold no `asset.read`, so linking to the register would send them to a
   * refusal.
   */
  it('does not link an employee to a register they cannot open', async () => {
    perms.add('asset.read.own');
    vi.mocked(assetsApi.mine).mockResolvedValue([held()]);
    render(<MyAssetsCard />);

    await screen.findByText('MAC-0042');
    expect(screen.queryByRole('link', { name: /MAC-0042/ })).not.toBeInTheDocument();
  });
});

describe('EmployeeAssetsCard', () => {
  /*
   * An employee record is open to every manager of that person. What they were
   * issued is the register's business, and the card must not even ask.
   */
  it('shows nothing and asks nothing without a register read', () => {
    render(<EmployeeAssetsCard employeeId="e1" />);

    expect(screen.queryByText(/company assets/i)).not.toBeInTheDocument();
    expect(assetsApi.heldBy).not.toHaveBeenCalled();
  });

  it('links each item through to the asset for somebody who can read it', async () => {
    perms.add('asset.read');
    vi.mocked(assetsApi.heldBy).mockResolvedValue([held()]);
    render(<EmployeeAssetsCard employeeId="e1" />);

    expect(await screen.findByRole('link', { name: 'MAC-0042' })).toHaveAttribute(
      'href',
      '/assets/a1',
    );
  });
});
