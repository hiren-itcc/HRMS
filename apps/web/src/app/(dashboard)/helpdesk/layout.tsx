'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function HelpdeskLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  const tabs = [
    { href: '/helpdesk', label: 'My tickets' },
    { href: '/helpdesk/queue', label: 'The desk', show: can('helpdesk.respond') },
    { href: '/helpdesk/categories', label: 'Categories', show: can('helpdesk.manage') },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Helpdesk" description="Ask a question, and follow what happens to it" />

      {/* A single tab is not a choice — somebody who does not work the desk
          sees only their own tickets. */}
      {tabs.filter((tab) => tab.show !== false).length > 1 && (
        <SectionTabs id="helpdesk-tab-pill" label="Helpdesk sections" tabs={tabs} />
      )}

      {children}
    </div>
  );
}
