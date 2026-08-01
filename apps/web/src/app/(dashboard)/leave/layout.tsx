'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function LeaveLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  return (
    <div className="space-y-6">
      <PageHeader title="Leave" description="Balances, requests and the company holiday calendar" />

      <SectionTabs
        id="leave-tab-pill"
        label="Leave sections"
        tabs={[
          { href: '/leave', label: 'My leave' },
          { href: '/leave/calendar', label: 'Calendar' },
          {
            href: '/leave/approvals',
            label: 'Approvals',
            show: can('leave.approve') || can('leave.approve.team'),
          },
          { href: '/leave/settings', label: 'Types & balances', show: can('leave.manage') },
        ]}
      />

      {children}
    </div>
  );
}
