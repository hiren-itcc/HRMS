import { Badge } from '@hrms/ui/components/badge';
import type { LetterStatus } from '../api';

export function LetterStatusBadge({ status }: { status: LetterStatus }) {
  if (status === 'VOID') return <Badge variant="destructive">Void</Badge>;
  return <Badge variant="secondary">Issued</Badge>;
}
