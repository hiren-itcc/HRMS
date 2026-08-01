import { Button } from '@hrms/ui/components/button';
import { FileQuestion } from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from '@/components/empty-state';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg items-center justify-center px-4">
      <EmptyState
        icon={FileQuestion}
        title="That page does not exist"
        hint="The link may be out of date, or the record may have been deleted."
        action={<Button render={<Link href="/dashboard" />}>Back to dashboard</Button>}
      />
    </div>
  );
}
