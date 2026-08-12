'use client';

import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

/**
 * Returns splits three ways: the monthly EPFO and ESIC files, the TDS challan
 * register, and the quarterly 24Q built from both.
 *
 * A second tab strip rather than three more entries on the payroll bar, which
 * already carries seven.
 */
export default function FilingsLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  return (
    <div className="space-y-5">
      <SectionTabs
        id="filings-tab-pill"
        label="Return types"
        tabs={[
          { href: '/payroll/filings', label: 'Monthly', show: can('payroll.read') },
          { href: '/payroll/filings/challans', label: 'TDS challans', show: can('payroll.read') },
          { href: '/payroll/filings/24q', label: 'Form 24Q', show: can('payroll.read') },
        ]}
      />
      {children}
    </div>
  );
}
