import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionTabs } from '@/components/section-tabs';

const pathname = vi.hoisted(() => ({ current: '/payroll/tax' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('SectionTabs', () => {
  it('marks an exact match current', () => {
    pathname.current = '/payroll/tax';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/tax', label: 'Income tax' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Income tax' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not mark a child route current by default', () => {
    // The existing behaviour every other layout relies on: /payroll must not
    // light up while you are on /payroll/salaries.
    pathname.current = '/payroll/tax/declarations';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/tax', label: 'Income tax' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Income tax' })).not.toHaveAttribute('aria-current');
  });

  it('marks a child route current when the tab opts into prefix matching', () => {
    pathname.current = '/payroll/tax/declarations';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/tax', label: 'Income tax', match: 'prefix' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Income tax' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('does not let a prefix tab claim a sibling that merely starts the same', () => {
    // /payroll/tax must not match /payroll/tax-archive.
    pathname.current = '/payroll/tax-archive';
    render(
      <SectionTabs
        id="t"
        label="Sections"
        tabs={[{ href: '/payroll/tax', label: 'Income tax', match: 'prefix' }]}
      />,
    );
    expect(screen.getByRole('link', { name: 'Income tax' })).not.toHaveAttribute('aria-current');
  });
});
