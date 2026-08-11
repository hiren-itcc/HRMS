'use client';

import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function PayrollLayout({ children }: { children: React.ReactNode }) {
  const { can, status } = useSession();

  // Anyone with any payroll sight gets in; each tab gates itself beyond that.
  const canEnter = can('payroll.read') || can('payroll.read.team') || can('payroll.read.own');

  if (status === 'authenticated' && !canEnter) return <NoAccess what="payroll" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="Salary structures, monthly runs, payslips and statutory reports"
        className="print:hidden"
      />

      <SectionTabs
        id="payroll-tab-pill"
        label="Payroll sections"
        tabs={[
          { href: '/payroll', label: 'Runs', show: can('payroll.read') },
          { href: '/payroll/salaries', label: 'Salaries', show: can('payroll.read') },
          {
            href: '/payroll/structures',
            label: 'Structures',
            show: can('payroll.structure.manage') || can('payroll.read'),
          },
          { href: '/payroll/settlements', label: 'Settlements', show: can('payroll.read') },
          { href: '/payroll/reports', label: 'Reports', show: can('payroll.read') },
          { href: '/payroll/filings', label: 'Returns', show: can('payroll.read') },
          { href: '/payroll/me', label: 'My salary', show: can('payroll.read.own') },
        ]}
      />

      {children}
    </div>
  );
}
