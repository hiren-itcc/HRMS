import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { companyApi, type OrgChartNode } from '@/features/organization/api';
import { render, screen, waitFor, within } from '@/test/render';
import OrgChartPage from './page';

vi.mock('@/features/organization/api', () => ({ companyApi: { chart: vi.fn() } }));

const node = (
  id: string,
  reports: OrgChartNode[] = [],
  extra: Partial<OrgChartNode> = {},
): OrgChartNode => ({
  id,
  firstName: id,
  lastName: 'Person',
  employeeCode: `EMP-${id}`,
  designation: 'Engineer',
  department: 'Engineering',
  avatarUrl: null,
  totalReports: reports.length,
  reports,
  ...extra,
});

function chartOf(roots: OrgChartNode[], total = 0) {
  vi.mocked(companyApi.chart).mockResolvedValue({ roots, total: total || roots.length });
}

beforeEach(() => vi.mocked(companyApi.chart).mockReset());

/**
 * Names render as `{firstName} {lastName}` — three text nodes, which
 * `getByText` will not match across. The link's accessible name is the honest
 * thing to assert on anyway.
 */
const person = (name: string) => screen.queryByRole('link', { name });
const findPerson = (name: string) => screen.findByRole('link', { name });

describe('OrgChartPage', () => {
  it('opens two levels deep and leaves the rest folded', async () => {
    chartOf([node('ceo', [node('cto', [node('dev', [node('intern')])])])], 4);
    render(<OrgChartPage />);

    // Levels 0–2 are visible; level 3 waits behind its parent's toggle, so a
    // large company opens to something readable rather than a wall of names.
    expect(await findPerson('ceo Person')).toBeInTheDocument();
    expect(person('cto Person')).toBeInTheDocument();
    expect(person('dev Person')).toBeInTheDocument();
    expect(person('intern Person')).not.toBeInTheDocument();
  });

  it('expands a folded branch when its toggle is pressed', async () => {
    chartOf([node('ceo', [node('cto', [node('dev', [node('intern')])])])], 4);
    render(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Expand dev Person/i }));
    expect(await findPerson('intern Person')).toBeInTheDocument();
  });

  it('collapses an open branch again', async () => {
    chartOf([node('ceo', [node('cto')])], 2);
    render(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Collapse ceo Person/i }));
    expect(person('cto Person')).not.toBeInTheDocument();
  });

  it('shows several roots without pretending one is the top', async () => {
    chartOf([node('a'), node('b')], 2);
    render(<OrgChartPage />);

    expect(await screen.findByText(/2 top-level/)).toBeInTheDocument();
  });

  it('keeps the ancestors of a search hit, and drops unrelated branches', async () => {
    chartOf([node('ceo', [node('cto', [node('needle')]), node('sales')])], 4);
    render(<OrgChartPage />);

    await userEvent.type(await screen.findByLabelText(/Find someone/i), 'needle');

    await waitFor(() => expect(person('needle Person')).toBeInTheDocument());
    // Its manager stays, so the hit keeps its context…
    expect(person('cto Person')).toBeInTheDocument();
    // …and an unrelated sibling goes.
    expect(person('sales Person')).not.toBeInTheDocument();
  });

  it('expands everything while searching — a deep hit must not stay hidden', async () => {
    chartOf([node('ceo', [node('cto', [node('deep')])])], 3);
    render(<OrgChartPage />);
    // 'deep' is at depth 2 and therefore collapsed before the search.
    expect(person('deep Person')).not.toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText(/Find someone/i), 'deep');
    expect(await findPerson('deep Person')).toBeInTheDocument();
  });

  it('searches job title and department, not just names', async () => {
    chartOf([node('a', [], { designation: 'Payroll Lead' })], 1);
    render(<OrgChartPage />);

    await userEvent.type(await screen.findByLabelText(/Find someone/i), 'payroll');
    expect(await findPerson('a Person')).toBeInTheDocument();
  });

  it('says so when a search matches nobody', async () => {
    chartOf([node('a')], 1);
    render(<OrgChartPage />);

    await userEvent.type(await screen.findByLabelText(/Find someone/i), 'zzzz');
    expect(await screen.findByText(/Nobody matches that/i)).toBeInTheDocument();
  });

  it('shows the count of everybody below, not just direct reports', async () => {
    chartOf([node('ceo', [node('cto')], { totalReports: 7 })], 8);
    render(<OrgChartPage />);

    const row = (await findPerson('ceo Person')).closest('li') as HTMLElement;
    expect(within(row).getByText('7')).toBeInTheDocument();
  });

  it('offers an empty state rather than a blank page for a new organization', async () => {
    chartOf([], 0);
    render(<OrgChartPage />);
    expect(await screen.findByText(/No reporting lines yet/i)).toBeInTheDocument();
  });

  it('renders an error state with a retry when the chart cannot load', async () => {
    vi.mocked(companyApi.chart).mockRejectedValue(new Error('boom'));
    render(<OrgChartPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
