'use client';

import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

/**
 * The tax section's own tab bar.
 *
 * This should have existed from the start. The sub-navigation was originally
 * two `Link` buttons floated above the page, which no other section does — the
 * projects, expenses and settings sections all use `SectionTabs`, and the
 * inconsistency was visible the moment somebody looked at two of them together.
 *
 * The parent payroll tab carries `match: 'prefix'`, so it stays lit while any
 * of these is open.
 */
export default function TaxLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/payroll/tax', label: 'My tax' },
    { href: '/payroll/tax/employees', label: 'Everyone’s tax', show: can('payroll.tax.view') },
    {
      href: '/payroll/tax/approvals',
      label: 'Declarations',
      show: can('payroll.tax.declaration.approve'),
    },
    { href: '/payroll/tax/rules', label: 'Tax rules', show: can('payroll.tax.manage') },
  ];

  return (
    <div className="space-y-4">
      {/* One tab is not a choice — somebody with no tax permissions beyond
          their own page sees no bar at all. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="tax-tab-pill" label="Income tax sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
