import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { companyApi, type OrgChartNode } from '@/features/organization/api';
import { render, screen, waitFor, within } from '@/test/render';
import OrgChartPage from './page';

vi.mock('@/features/organization/api', () => ({
  companyApi: { chart: vi.fn(), get: vi.fn() },
}));

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

beforeEach(() => {
  vi.mocked(companyApi.chart).mockReset();
  vi.mocked(companyApi.get).mockResolvedValue({
    id: 'org1',
    name: 'Acme',
    slug: 'acme',
    timezone: 'UTC',
    logoUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  });
});

/**
 * Names render as `{firstName} {lastName}` — three text nodes, which
 * `getByText` will not match across. The link's accessible name is the honest
 * thing to assert on anyway.
 */
const person = (name: string) => screen.queryByRole('link', { name });
const findPerson = (name: string) => screen.findByRole('link', { name });

describe('OrgChartPage', () => {
  it('opens to the top level and no further', async () => {
    chartOf([node('ceo', [node('cto', [node('dev')])])], 3);
    render(<OrgChartPage />);

    // The company card is open, so its top level shows — and nothing below it.
    // Drawing the whole company at once is the one thing a top-down chart
    // cannot do: a level is as wide as every expanded branch in it put together.
    expect(await findPerson('ceo Person')).toBeInTheDocument();
    expect(person('cto Person')).not.toBeInTheDocument();
  });

  it('walks down one level at a time', async () => {
    chartOf([node('ceo', [node('cto', [node('dev')])])], 3);
    render(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Expand ceo Person/i }));
    expect(await findPerson('cto Person')).toBeInTheDocument();
    expect(person('dev Person')).not.toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Expand cto Person/i }));
    expect(await findPerson('dev Person')).toBeInTheDocument();
  });

  /*
   * The whole point of the change, and invisible to every other assertion here:
   * opening one branch has to close the other, or the chart grows sideways
   * until it is unreadable — which is exactly what the first version did.
   */
  it('closes the open branch when another is opened', async () => {
    chartOf([node('a', [node('a-report')]), node('b', [node('b-report')])], 4);
    render(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Expand a Person/i }));
    expect(await findPerson('a-report Person')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Expand b Person/i }));
    expect(await findPerson('b-report Person')).toBeInTheDocument();
    expect(person('a-report Person')).not.toBeInTheDocument();
  });

  it('collapses an open branch again', async () => {
    chartOf([node('ceo', [node('cto')])], 2);
    render(<OrgChartPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Expand ceo Person/i }));
    expect(await findPerson('cto Person')).toBeInTheDocument();

    await userEvent.click(await screen.findByRole('button', { name: /Collapse ceo Person/i }));
    expect(person('cto Person')).not.toBeInTheDocument();
  });

  /*
   * The company is the root, and that is not the same as promoting somebody.
   * Several people with no manager all hang off it, and the count still says
   * how many there are.
   */
  it('hangs several top-level people off the company, promoting none of them', async () => {
    chartOf([node('a'), node('b')], 2);
    render(<OrgChartPage />);

    expect(await screen.findByText(/2 top-level/)).toBeInTheDocument();
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(await findPerson('a Person')).toBeInTheDocument();
    expect(person('b Person')).toBeInTheDocument();
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

  /*
   * Searching opens the way *down to* a match rather than opening everything.
   * Opening everything is what made the chart unreadable, but a hit that stays
   * hidden behind a collapsed branch is no better — so the path opens itself.
   */
  it('opens the path down to a search hit', async () => {
    chartOf([node('ceo', [node('cto', [node('deep')])])], 3);
    render(<OrgChartPage />);
    // 'deep' is two levels below the top and therefore closed before the search.
    expect(person('deep Person')).not.toBeInTheDocument();

    await userEvent.type(await screen.findByLabelText(/Find someone/i), 'deep');
    expect(await findPerson('deep Person')).toBeInTheDocument();
    // Its managers came with it, so the hit keeps its context.
    expect(person('cto Person')).toBeInTheDocument();
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
