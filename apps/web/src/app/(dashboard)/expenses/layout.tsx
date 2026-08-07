'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function ExpensesLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/expenses', label: 'My claims' },
    {
      href: '/expenses/approvals',
      label: 'Approvals',
      show: can('expense.approve') || can('expense.approve.team'),
    },
    {
      href: '/expenses/categories',
      label: 'Categories',
      show: can('expense.manage'),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Claim back what you spent, and see when it is paid"
      />

      {/* A single tab is not a choice — an employee with no approval or
          category scope sees only their own claims. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="expenses-tab-pill" label="Expense sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
