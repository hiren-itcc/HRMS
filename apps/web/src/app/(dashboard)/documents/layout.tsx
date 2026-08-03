'use client';

import { PageHeader } from '@/components/page-header';
import { SectionTabs } from '@/components/section-tabs';
import { useSession } from '@/components/session-provider';

/**
 * Documents is two jobs wearing one name: the files that are yours, and the
 * files of everyone in the organization. They were the same screen, which is
 * why "why can an employee see Documents?" was a fair question — the answer
 * was "they only ever saw their own", but nothing on screen said so.
 *
 * No guard here: every role has somewhere to go in this module. Each tab
 * gates itself, exactly as payroll does.
 */
export default function DocumentsLayout({ children }: { children: React.ReactNode }) {
  const { can } = useSession();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Documents"
        description="Personnel files — resumes, ID proofs, contracts and certificates"
      />

      <SectionTabs
        id="documents-tab-pill"
        label="Document sections"
        tabs={[
          { href: '/documents', label: 'My documents' },
          { href: '/documents/letters', label: 'My letters', show: can('letter.read.own') },
          { href: '/documents/admin', label: 'All employees', show: can('document.read') },
          { href: '/documents/folders', label: 'Folders', show: can('document.manage') },
        ]}
      />

      {children}
    </div>
  );
}
