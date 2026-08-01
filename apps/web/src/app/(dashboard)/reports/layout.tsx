'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Headcount, attendance, leave and department analytics"
        className="print:hidden"
      />

      <SectionTabs
        id="reports-tab-pill"
        label="Report sections"
        tabs={[
          { href: '/reports', label: 'Employees' },
          { href: '/reports/attendance', label: 'Attendance' },
          { href: '/reports/leave', label: 'Leave' },
          { href: '/reports/departments', label: 'Departments' },
        ]}
      />

      {children}
    </div>
  );
}
