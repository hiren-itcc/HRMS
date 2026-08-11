'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function PerformanceLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/performance', label: 'My performance' },
    {
      href: '/performance/team',
      label: 'Team',
      show: can('performance.read.team') || can('performance.read'),
    },
    { href: '/performance/cycles', label: 'Cycles', show: can('performance.manage') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Performance" description="Goals, check-ins and review cycles" />

      {/* One tab is not a choice — an employee with no team or cycle scope
          sees only their own goals and their own review. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="performance-tab-pill" label="Performance sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
