import { ASSET_STATUS_LABELS, type AssetStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';

/**
 * Colour carries no meaning on its own here — every badge says its status in
 * words, because "is the amber one bad?" is a question a register should never
 * make somebody ask.
 */
const TONE: Record<AssetStatusCode, string> = {
  IN_STOCK: 'bg-success/15 text-success-text',
  ASSIGNED: 'bg-info/15 text-info-text',
  IN_REPAIR: 'bg-warning/15 text-warning-text',
  LOST: 'bg-destructive/15 text-destructive-text',
  RETIRED: 'bg-muted text-muted-foreground',
};

export function AssetStatusBadge({ status }: { status: AssetStatusCode }) {
  return (
    <Badge className={cn('border-transparent', TONE[status])}>{ASSET_STATUS_LABELS[status]}</Badge>
  );
}
