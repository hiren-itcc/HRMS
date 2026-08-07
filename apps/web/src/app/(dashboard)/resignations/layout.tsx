'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

/**
 * One section for the whole exit journey.
 *
 * Resignations and offboardings are tabs rather than two nav entries: the
 * sidebar is a flat list of eleven items, and somebody looking for "who is
 * leaving" should not have to know whether they resigned or were let go.
 */
export default function ExitsLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  return (
    <div className="space-y-6">
      <PageHeader title="Exits" description="Resignations, notice periods and offboarding" />

      <SectionTabs
        id="exits-tab-pill"
        label="Exit sections"
        tabs={[
          { href: '/resignations', label: 'My resignation' },
          {
            href: '/resignations/approvals',
            label: 'Approvals',
            show: can('resignation.approve') || can('resignation.approve.team'),
          },
          {
            href: '/resignations/offboarding',
            label: 'Offboarding',
            show: can('employee.offboard'),
          },
        ]}
      />

      {children}
    </div>
  );
}
