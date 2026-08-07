'use client';

import { NoAccess } from '@/components/no-access';
import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

export default function AssetsLayout({ children }: { children: React.ReactNode }) {
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('asset.read')) return <NoAccess what="assets" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Assets" description="Everything the company owns, and who is holding it" />

      <SectionTabs
        id="assets-tab-pill"
        label="Asset sections"
        tabs={[
          { href: '/assets', label: 'Register', show: true },
          { href: '/assets/categories', label: 'Categories', show: can('asset.manage') },
        ]}
      />

      {children}
    </div>
  );
}
