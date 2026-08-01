'use client';

import { Suspense } from 'react';
import { ReportView } from '@/features/reports/components/report-view';

export default function EmployeeReportPage() {
  return (
    <Suspense>
      <ReportView report="employees" emptyTitle="No employees in this range" />
    </Suspense>
  );
}
