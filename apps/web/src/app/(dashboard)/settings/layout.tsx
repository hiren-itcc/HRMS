'use client';

import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { can, status } = useSession();

  // Anyone who can administer *something* gets in; each tab gates itself.
  const canEnter =
    can('settings.manage') || can('role.manage') || can('audit.read') || can('org.manage');

  if (status === 'authenticated' && !canEnter) {
    return <NoAccess what="workspace settings" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Workspace configuration, access control and the audit trail"
      />

      <SectionTabs
        id="settings-tab-pill"
        label="Settings sections"
        tabs={[
          { href: '/settings', label: 'Overview' },
          { href: '/settings/preferences', label: 'Preferences', show: can('settings.manage') },
          { href: '/settings/roles', label: 'Roles', show: can('role.manage') },
          { href: '/settings/email', label: 'Email templates', show: can('settings.manage') },
          { href: '/settings/audit', label: 'Audit log', show: can('audit.read') },
        ]}
      />

      {children}
    </div>
  );
}
