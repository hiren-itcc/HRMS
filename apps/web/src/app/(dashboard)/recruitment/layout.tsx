'use client';

import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function RecruitmentLayout({ children }: { children: React.ReactNode }) {
  const { can, status } = useSession();

  // Either read is enough to reach the module: a hiring manager holds only the
  // team one and must still get in — the API narrows what they then see.
  const canRead = can('recruitment.read') || can('recruitment.read.team');
  if (status === 'authenticated' && !canRead) return <NoAccess what="recruitment" />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recruitment"
        description="Openings, the people applying for them, and who is being hired"
      />

      <SectionTabs
        id="recruitment-tab-pill"
        label="Recruitment sections"
        tabs={[
          { href: '/recruitment', label: 'Openings', show: true },
          { href: '/recruitment/candidates', label: 'Candidates', show: true },
        ]}
      />

      {children}
    </div>
  );
}
