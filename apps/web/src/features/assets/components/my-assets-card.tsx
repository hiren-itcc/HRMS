'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/components/session-provider';
import { assetKeys, assetsApi } from '../api';
import { HeldAssets } from './held-assets';

/**
 * "Issued to me", on the profile.
 *
 * Read-only on purpose: the register is IT's record, and an employee editing
 * it would be the register disagreeing with itself. What it is for is that
 * somebody who cannot see their own list cannot return it — which matters most
 * on the way out, when the exit clearance is counting.
 *
 * Rendered with nothing to show as well as with something, because "nothing is
 * issued to you" is an answer worth reading before your last day.
 */
export function MyAssetsCard() {
  const { can } = useSession();
  const canRead = can('asset.read.own');

  const query = useQuery({
    queryKey: assetKeys.mine(),
    queryFn: () => assetsApi.mine(),
    enabled: canRead,
  });

  if (!canRead) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issued to me</CardTitle>
        <CardDescription>
          Company property in your keeping. Hand it back to IT before your last day.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <HeldAssets
          items={query.data}
          loading={query.isPending}
          // They hold no `asset.read`, so a link would land them on a refusal.
          linkToAsset={false}
          emptyText="Nothing is issued to you."
        />
      </CardContent>
    </Card>
  );
}
