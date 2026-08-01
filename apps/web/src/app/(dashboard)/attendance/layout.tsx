'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/attendance', label: 'My attendance' },
    {
      href: '/attendance/team',
      label: 'Team',
      show: can('attendance.read') || can('attendance.read.team'),
    },
    {
      href: '/attendance/approvals',
      label: 'Approvals',
      show: can('attendance.approve') || can('attendance.approve.team'),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Clock in and out, review your history and handle corrections"
      />

      {/* A single tab is not a choice — an employee with no team scope sees
          only their own attendance, so the strip would be decoration. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="attendance-tab-pill" label="Attendance sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
