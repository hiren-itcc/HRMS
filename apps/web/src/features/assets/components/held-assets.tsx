'use client';

import { ASSET_CONDITION_LABELS } from '@hrms/shared';
import { Skeleton } from '@hrms/ui/components/skeleton';
import Link from 'next/link';
import type { HeldAsset } from '../api';

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * What somebody is holding right now.
 *
 * Shared by the profile card, the employee record and the exit clearance, so
 * all three read the same list rather than three views of it that can drift.
 * `linkToAsset` is off for the employee's own view — they have no
 * `asset.read`, so a link would land them on a 403.
 */
export function HeldAssets({
  items,
  loading,
  linkToAsset,
  emptyText = 'Nothing is issued to them.',
}: {
  items: HeldAsset[] | undefined;
  loading: boolean;
  linkToAsset: boolean;
  emptyText?: string;
}) {
  if (loading) return <Skeleton className="h-16 w-full rounded-lg" />;
  if (!items || items.length === 0) {
    return <p className="text-muted-foreground text-sm">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2.5">
      {items.map((held) => (
        <li key={held.id} className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="min-w-0">
            {linkToAsset ? (
              <Link href={`/assets/${held.asset.id}`} className="font-medium hover:underline">
                {held.asset.assetTag}
              </Link>
            ) : (
              <span className="font-medium">{held.asset.assetTag}</span>
            )}
            <span className="text-muted-foreground"> · {held.asset.name}</span>
            {held.asset.serialNumber && (
              <span className="block text-muted-foreground text-xs">
                Serial {held.asset.serialNumber}
              </span>
            )}
          </span>
          <span className="shrink-0 text-muted-foreground text-xs">
            Since {dateFmt.format(new Date(held.issuedOn))} ·{' '}
            {ASSET_CONDITION_LABELS[held.conditionOut].toLowerCase()}
          </span>
        </li>
      ))}
    </ul>
  );
}
