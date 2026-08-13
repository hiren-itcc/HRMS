'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/projects', label: 'Projects' },
    { href: '/projects/timesheet', label: 'My timesheet', show: can('timesheet.read.own') },
    {
      href: '/projects/approvals',
      label: 'Approvals',
      show: can('timesheet.approve.team'),
    },
    { href: '/projects/utilisation', label: 'Utilisation', show: can('project.read') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        description="What is being worked on, who is on it, and where the hours went"
      />

      {/* A single tab is not a choice — somebody on no project with no approval
          scope sees only the register. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="projects-tab-pill" label="Project sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
