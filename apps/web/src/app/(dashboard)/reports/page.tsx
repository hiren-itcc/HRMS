'use client';

import { Suspense } from 'react';
import { EmployeeStatusCell } from '@/features/employees/components/status-badge';
import { ReportView } from '@/features/reports/components/report-view';

export default function EmployeeReportPage() {
  return (
    <Suspense>
      <ReportView
        report="employees"
        emptyTitle="No employees in this range"
        // The roster's own screen badges this column; a report that spells out
        // ON_NOTICE beside it looks like a different system.
        cells={{ status: (value) => <EmployeeStatusCell value={value} /> }}
      />
    </Suspense>
  );
}
