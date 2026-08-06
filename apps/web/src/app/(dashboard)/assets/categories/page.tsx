'use client';

import { type AssetCategoryInput, assetCategorySchema } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { FormDialog } from '@/components/crud/form-dialog';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { FormInput } from '@/components/form';
import { useSession } from '@/components/session-provider';
import { type AssetCategory, assetKeys, assetsApi } from '@/features/assets/api';
import { useApiMutation } from '@/hooks/use-crud';
import { useZodForm } from '@/hooks/use-zod-form';

export default function AssetCategoriesPage() {
  const { can } = useSession();
  const canManage = can('asset.manage');
  const [editing, setEditing] = useState<AssetCategory | 'new' | null>(null);

  const query = useQuery({
    queryKey: assetKeys.categories(),
    queryFn: () => assetsApi.categories(),
  });

  const form = useZodForm<AssetCategoryInput>(assetCategorySchema, {
    defaultValues: { name: '' },
  });

  const invalidate = [assetKeys.all()];

  const save = useApiMutation({
    mutationFn: (input: AssetCategoryInput) =>
      editing && editing !== 'new'
        ? assetsApi.updateCategory(editing.id, input)
        : assetsApi.createCategory(input),
    invalidate,
    success: 'Category saved',
    onSuccess: () => setEditing(null),
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => assetsApi.removeCategory(id),
    invalidate,
    success: 'Category removed',
  });

  const columns: Column<AssetCategory>[] = [
    { key: 'name', header: 'Category', alwaysVisible: true, render: (row) => row.name },
    {
      key: 'count',
      header: 'Assets',
      render: (row) => <span className="tabular-nums">{row._count?.assets ?? 0}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button
            onClick={() => {
              form.reset({ name: '' });
              setEditing('new');
            }}
          >
            <Plus className="size-4" aria-hidden /> Add a category
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="No categories yet"
        emptyHint="An asset has to be filed under one, so add the kinds of thing you issue."
        actions={(row) => (
          <RowActions
            name={row.name}
            editPerm="asset.manage"
            deleting={remove.isPending}
            onEdit={() => {
              form.reset({ name: row.name });
              setEditing(row);
            }}
            onDelete={() => remove.mutate(row.id)}
          />
        )}
      />

      <FormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing === 'new' ? 'Add a category' : 'Rename the category'}
        submitting={save.isPending}
        submitLabel="Save"
        onSubmit={form.handleSubmit((values) => save.mutate(values))}
      >
        <FormInput control={form.control} name="name" label="Name" placeholder="Laptop" />
      </FormDialog>
    </div>
  );
}
