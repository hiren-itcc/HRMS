'use client';

import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

const TABS = [
  { href: '/organization', label: 'Company' },
  { href: '/organization/departments', label: 'Departments' },
  { href: '/organization/designations', label: 'Designations' },
  { href: '/organization/employment-types', label: 'Employment types' },
  { href: '/organization/locations', label: 'Locations' },
  { href: '/organization/shifts', label: 'Shifts' },
  { href: '/organization/holidays', label: 'Holidays' },
];

export default function OrganizationLayout({ children }: { children: React.ReactNode }) {
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('org.read')) {
    return <NoAccess what="organization settings" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization"
        description="Company structure, work locations, shifts and holidays"
      />

      <SectionTabs id="org-tab-pill" label="Organization sections" tabs={TABS} />

      {children}
    </div>
  );
}
