'use client';

import { Suspense } from 'react';
import { ReportView } from '@/features/reports/components/report-view';

export default function LeaveReportPage() {
  return (
    <Suspense>
      <ReportView report="leave" emptyTitle="No leave in this range" />
    </Suspense>
  );
}
