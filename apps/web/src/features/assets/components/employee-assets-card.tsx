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
 * What one person is holding, on their employee record.
 *
 * Gated on `asset.read` and does not call the API without it — an employee
 * record is open to every manager of that person, and what somebody was issued
 * is the register's business.
 */
export function EmployeeAssetsCard({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const canRead = can('asset.read');

  const query = useQuery({
    queryKey: assetKeys.heldBy(employeeId),
    queryFn: () => assetsApi.heldBy(employeeId),
    enabled: canRead,
  });

  if (!canRead) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Company assets</CardTitle>
        <CardDescription>What they are holding right now</CardDescription>
      </CardHeader>
      <CardContent>
        <HeldAssets items={query.data} loading={query.isPending} linkToAsset />
      </CardContent>
    </Card>
  );
}
