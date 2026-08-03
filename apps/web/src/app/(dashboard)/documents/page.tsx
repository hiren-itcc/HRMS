'use client';

import { Card, CardContent } from '@hrms/ui/components/card';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { DocumentsBrowser } from '@/features/documents/documents-browser';

/**
 * My documents — always the signed-in person's own files, for every role.
 * Folder administration and the org-wide list are sibling tabs, so this page
 * has exactly one job.
 */
export default function DocumentsPage() {
  const { user } = useSession();
  const employeeId = user?.employee?.id;

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        {employeeId ? (
          <DocumentsBrowser employeeId={employeeId} />
        ) : (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground text-sm">
              No employee record is linked to this account, so there are no personal documents.
            </CardContent>
          </Card>
        )}
      </FadeInItem>
    </Stagger>
  );
}
