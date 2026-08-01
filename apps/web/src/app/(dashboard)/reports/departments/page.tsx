'use client';

import { Suspense } from 'react';
import { ReportView } from '@/features/reports/components/report-view';

export default function DepartmentReportPage() {
  return (
    <Suspense>
      <ReportView
        report="departments"
        showDepartmentFilter={false}
        emptyTitle="No departments to show"
      />
    </Suspense>
  );
}
