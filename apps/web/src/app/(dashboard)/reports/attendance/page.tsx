'use client';

import { Suspense } from 'react';
import { ReportView } from '@/features/reports/components/report-view';

export default function AttendanceReportPage() {
  return (
    <Suspense>
      <ReportView report="attendance" emptyTitle="No attendance in this range" />
    </Suspense>
  );
}
