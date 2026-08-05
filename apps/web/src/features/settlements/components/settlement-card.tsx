'use client';

import { SETTLEMENT_STATUS_LABELS, type SettlementStatusCode } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { IndianRupee } from 'lucide-react';
import Link from 'next/link';
import { useSession } from '@/components/session-provider';
import { formatMoney } from '@/features/payroll/api';
import { useApiMutation } from '@/hooks/use-crud';
import { settlementKeys, settlementsApi } from '../api';

const TONE: Record<SettlementStatusCode, string> = {
  DRAFT: 'bg-warning/15 text-warning-text',
  APPROVED: 'bg-info/15 text-info-text',
  PAID: 'bg-success/15 text-success-text',
  CANCELLED: 'bg-muted text-muted-foreground',
};

/**
 * The money half of the exit, on the exit page.
 *
 * Rendered only for somebody who holds a payroll read — an exit page that
 * shows a colleague's payout to every HR user is a leak. The card is where a
 * settlement is started, because this is the screen that has the last working
 * day and the clearance in front of it.
 */
export function SettlementCard({ offboardingId }: { offboardingId: string }) {
  const { can } = useSession();
  const canRead = can('payroll.read');
  const canPrepare = can('payroll.process');

  const query = useQuery({
    queryKey: settlementKeys.forOffboarding(offboardingId),
    queryFn: () => settlementsApi.forOffboarding(offboardingId),
    enabled: canRead,
  });

  const prepare = useApiMutation({
    mutationFn: () => settlementsApi.create({ offboardingId }),
    invalidate: [settlementKeys.forOffboarding(offboardingId), settlementKeys.all()],
    success: 'Settlement prepared',
  });

  if (!canRead) return null;

  const settlement = query.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle>Full &amp; final settlement</CardTitle>
            <CardDescription>
              {settlement
                ? 'Leave encashment, notice recovery and gratuity, as computed'
                : 'Prepare it when the leave balance and clearance have settled'}
            </CardDescription>
          </div>
          {settlement ? (
            <Badge className={cn('border-transparent', TONE[settlement.status])}>
              {SETTLEMENT_STATUS_LABELS[settlement.status]}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <Skeleton className="h-10 w-full rounded-lg" />
        ) : settlement ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs">Net payable</p>
              <p
                className={cn(
                  'font-semibold text-lg tabular-nums',
                  settlement.netPayable < 0 && 'text-destructive-text',
                )}
              >
                {formatMoney(settlement.netPayable)}
              </p>
              {settlement.netPayable < 0 && (
                <p className="text-muted-foreground text-xs">
                  Recovery exceeds what they are owed — this is due back.
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              render={<Link href={`/payroll/settlements/${settlement.id}`} />}
            >
              Open statement
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">
              Nothing has been computed for this exit yet.
            </p>
            {canPrepare && (
              <Button size="sm" disabled={prepare.isPending} onClick={() => prepare.mutate()}>
                <IndianRupee className="size-4" aria-hidden /> Prepare settlement
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
