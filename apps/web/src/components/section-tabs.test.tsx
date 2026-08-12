import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionTabs } from '@/components/section-tabs';

const pathname = vi.hoisted(() => ({ current: '/payroll/filings' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('SectionTabs', () => {
  it('marks an exact match current', () => {
    pathname.current = '/payroll/filings';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/filings', label: 'Returns' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Returns' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not mark a child route current by default', () => {
    // The existing behaviour every other layout relies on: /payroll must not
    // light up while you are on /payroll/salaries.
    pathname.current = '/payroll/filings/challans';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/filings', label: 'Returns' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Returns' })).not.toHaveAttribute('aria-current');
  });

  it('marks a child route current when the tab opts into prefix matching', () => {
    pathname.current = '/payroll/filings/challans';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/filings', label: 'Returns', match: 'prefix' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Returns' })).toHaveAttribute('aria-current', 'page');
  });

  it('does not let a prefix tab claim a sibling that merely starts the same', () => {
    // /payroll/filings must not match /payroll/filings-archive.
    pathname.current = '/payroll/filings-archive';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/filings', label: 'Returns', match: 'prefix' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Returns' })).not.toHaveAttribute('aria-current');
  });
});
