import { ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';

/**
 * Shown when a signed-in user reaches a section their role does not cover.
 * Names what is out of reach rather than saying "forbidden" — the person has
 * not done anything wrong, they simply are not an administrator.
 */
export function NoAccess({ what }: { what: string }) {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="No access"
      hint={`You don't have permission to view ${what}.`}
      className="py-24"
    />
  );
}
