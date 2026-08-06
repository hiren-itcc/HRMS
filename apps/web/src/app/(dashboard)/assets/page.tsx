'use client';

import {
  ASSET_CONDITION_LABELS,
  ASSET_CONDITIONS,
  ASSET_STATUS_LABELS,
  ASSET_STATUSES,
  type AssetStatusCode,
  assetCreateSchema,
} from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { useQuery } from '@tanstack/react-query';
import { Eye, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { z } from 'zod';
import { FormDialog } from '@/components/crud/form-dialog';
import { type Column, DataTable } from '@/components/data-table';
import { FormInput, FormSelect } from '@/components/form';
import { IconAction } from '@/components/icon-action';
import { useSession } from '@/components/session-provider';
import { type Asset, assetKeys, assetsApi, holderOf } from '@/features/assets/api';
import { AssetStatusBadge } from '@/features/assets/components/asset-status-badge';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

const PAGE_SIZE = 20;

/**
 * The *input* type, not the output. `condition` carries a zod default, so the
 * parsed type has it required while the form legitimately starts without it —
 * the same split `/leave/settings` already resolves this way.
 */
type AssetValues = z.input<typeof assetCreateSchema>;

export default function AssetsPage() {
  const { can } = useSession();
  const canManage = can('asset.manage');

  const [status, setStatus] = useState<AssetStatusCode | 'ALL'>('ALL');
  const [categoryId, setCategoryId] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);

  const categories = useQuery({
    queryKey: assetKeys.categories(),
    queryFn: () => assetsApi.categories(),
  });

  const params = {
    page,
    limit: PAGE_SIZE,
    ...(status === 'ALL' ? {} : { status }),
    ...(categoryId === 'ALL' ? {} : { categoryId }),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const query = useQuery({
    queryKey: assetKeys.list(params),
    queryFn: () => assetsApi.list(params),
  });

  const form = useZodForm<AssetValues>(assetCreateSchema, {
    defaultValues: { categoryId: '', assetTag: '', name: '', condition: 'GOOD' },
  });

  const create = useApiMutation({
    mutationFn: (input: AssetValues) => assetsApi.create(assetCreateSchema.parse(input)),
    invalidate: [assetKeys.all()],
    success: 'Asset added',
    onSuccess: () => setAdding(false),
  });

  const columns: Column<Asset>[] = [
    {
      key: 'assetTag',
      header: 'Tag',
      sortable: true,
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/assets/${row.id}`} className="hover:underline">
          <span className="font-medium">{row.assetTag}</span>
          <span className="block text-muted-foreground text-xs">{row.name}</span>
        </Link>
      ),
    },
    { key: 'category', header: 'Category', render: (row) => row.category.name },
    {
      key: 'serialNumber',
      header: 'Serial',
      className: 'hidden lg:table-cell',
      render: (row) => <span className="tabular-nums">{row.serialNumber ?? '—'}</span>,
    },
    {
      key: 'holder',
      header: 'Held by',
      className: 'hidden sm:table-cell',
      render: (row) => {
        const holder = holderOf(row);
        if (!holder) return <span className="text-muted-foreground">—</span>;
        return (
          <Link href={`/employees/${holder.id}`} className="hover:underline">
            {holder.firstName} {holder.lastName}
          </Link>
        );
      },
    },
    { key: 'status', header: 'Status', render: (row) => <AssetStatusBadge status={row.status} /> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Tag, serial or name"
          aria-label="Search the register"
          className="w-full sm:w-64"
        />

        <Select
          value={categoryId}
          onValueChange={(v) => {
            setCategoryId(v);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-44" aria-label="Filter by category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {(categories.data ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as AssetStatusCode | 'ALL');
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Any status</SelectItem>
            {ASSET_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ASSET_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {canManage && (
          <Button
            className="sm:ml-auto"
            disabled={(categories.data ?? []).length === 0}
            onClick={() => {
              form.reset({ categoryId: '', assetTag: '', name: '', condition: 'GOOD' });
              setAdding(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Add an asset
          </Button>
        )}
      </div>

      {canManage && categories.data?.length === 0 && (
        <p className="text-muted-foreground text-sm">
          Nothing can be added until there is a category to file it under.{' '}
          <Link href="/assets/categories" className="underline">
            Add one first
          </Link>
          .
        </p>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        meta={query.data?.meta}
        onPageChange={setPage}
        emptyTitle={search ? 'Nothing matches that' : 'The register is empty'}
        emptyHint={
          search
            ? 'Try the asset tag, the serial number, or part of the name.'
            : 'Add the first thing the company owns, and issue it to somebody.'
        }
        actions={(row) => (
          <IconAction
            label={`View ${row.assetTag}`}
            icon={Eye}
            render={<Link href={`/assets/${row.id}`} />}
          />
        )}
      />

      <FormDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an asset"
        description="One row per physical thing — a serial is what makes it a specific one."
        submitting={create.isPending}
        submitLabel="Add"
        onSubmit={form.handleSubmit((values) => create.mutate(values))}
      >
        <FormSelect
          control={form.control}
          name="categoryId"
          label="Category"
          busy={categories.isPending}
        >
          {(categories.data ?? []).map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </FormSelect>
        <FormInput
          control={form.control}
          name="assetTag"
          label="Asset tag"
          placeholder="MAC-0042"
          hint="What is printed on the sticker. Must be unique."
        />
        <FormInput control={form.control} name="name" label="Name" placeholder="MacBook Pro 14" />
        <FormInput
          control={form.control}
          name="serialNumber"
          label="Serial number"
          placeholder="Optional"
        />
        <FormSelect control={form.control} name="condition" label="Condition">
          {ASSET_CONDITIONS.map((c) => (
            <SelectItem key={c} value={c}>
              {ASSET_CONDITION_LABELS[c]}
            </SelectItem>
          ))}
        </FormSelect>
      </FormDialog>
    </div>
  );
}
