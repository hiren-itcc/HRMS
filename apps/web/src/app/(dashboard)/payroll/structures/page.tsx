'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Pencil, Power, PowerOff, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { CrudShell } from '@/components/crud/crud-shell';
import { type Column, DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { formatMoney, payrollApi, payrollKeys } from '@/features/payroll/api';
import type { SalaryStructure } from '@/features/payroll/types';
import { useApiMutation } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const CALC_LABEL: Record<string, string> = {
  FLAT: 'flat',
  PERCENT_OF_BASIC: '% of basic',
  PERCENT_OF_CTC: '% of CTC',
  STATUTORY: 'statutory',
  BALANCE: 'balance',
};

export default function StructuresPage() {
  const params = useListParams('name');
  const router = useRouter();
  const _queryClient = useQueryClient();
  const { can } = useSession();

  const listQuery = {
    page: params.page,
    limit: 10,
    search: params.search,
    sort: params.sort,
    order: params.order,
  };
  const list = useQuery({
    queryKey: [...payrollKeys.structures(), listQuery],
    queryFn: () => payrollApi.structures(listQuery),
  });

  const clone = useApiMutation({
    mutationFn: (id: string) => payrollApi.cloneStructure(id),
    error: 'Could not clone the structure',
    success: (created) => `Cloned as ${created.name} — it starts inactive`,
    invalidate: [payrollKeys.structures()],
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => payrollApi.deleteStructure(id),
    error: 'Could not delete the structure',
    success: 'Structure deleted',
    invalidate: [payrollKeys.structures()],
  });

  /*
   * The delete button on an assigned structure says "deactivate it instead".
   * Doing that meant opening the editor and finding a switch, which is a poor
   * answer to advice given right here — so the advice is now the click.
   *
   * Deactivating leaves every existing assignment alone. It only stops the
   * structure being picked for the next one, which is the point: the employees
   * on it keep being paid from it.
   */
  const setActive = useApiMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      payrollApi.updateStructure(id, { isActive }),
    error: 'Could not change whether it is active',
    success: (_result, { isActive }) =>
      isActive
        ? 'Structure reactivated'
        : 'Structure deactivated — existing assignments are unchanged',
    invalidate: [payrollKeys.structures()],
  });

  const columns: Column<SalaryStructure>[] = [
    {
      key: 'name',
      header: 'Structure',
      sortable: true,
      alwaysVisible: true,
      render: (row) => (
        <span>
          <span className="font-medium">{row.name}</span>
          <span className="block text-muted-foreground text-xs">{row.code}</span>
        </span>
      ),
    },
    {
      key: 'components',
      header: 'Components',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.lines.slice(0, 4).map((line) => (
            <Badge key={line.id} variant="outline" className="font-normal">
              {line.componentName}
              <span className="text-muted-foreground">
                {' '}
                {line.calcType === 'FLAT'
                  ? formatMoney(line.value)
                  : line.calcType === 'BALANCE'
                    ? CALC_LABEL.BALANCE
                    : `${line.value}${CALC_LABEL[line.calcType]?.replace('%', '%') ?? ''}`}
              </span>
            </Badge>
          ))}
          {row.lines.length > 4 && (
            <Badge variant="outline" className="font-normal">
              +{row.lines.length - 4}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'assignedCount',
      header: 'Assigned',
      className: 'hidden sm:table-cell tabular-nums',
      render: (row) => row.assignedCount,
    },
    {
      key: 'isActive',
      header: 'Status',
      render: (row) => (
        <Badge variant={row.isActive ? 'success' : 'outline'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  return (
    <CrudShell
      title="Salary structures"
      description="Reusable earning and deduction templates, resolved against each employee's CTC"
      search={params.search}
      onSearchChange={params.setSearch}
      managePerm="payroll.structure.manage"
      onAdd={() => router.push('/payroll/structures/new')}
      addLabel="New structure"
    >
      <DataTable
        columns={columns}
        rows={list.data?.data}
        rowKey={(row) => row.id}
        loading={list.isLoading}
        error={list.isError}
        onRetry={() => list.refetch()}
        meta={list.data?.meta}
        onPageChange={params.setPage}
        sort={params.sort}
        order={params.order}
        onSortChange={params.toggleSort}
        emptyTitle="No salary structures yet"
        emptyHint="A structure defines how CTC splits into basic, allowances and deductions. Use New structure to build the first one."
        actions={
          can('payroll.structure.manage')
            ? (row) => (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${row.name}`}
                    onClick={() => router.push(`/payroll/structures/${row.id}`)}
                  >
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Clone ${row.name}`}
                    disabled={clone.isPending}
                    onClick={() => clone.mutate(row.id)}
                  >
                    <Copy className="size-4" aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${row.isActive ? 'Deactivate' : 'Reactivate'} ${row.name}`}
                    disabled={setActive.isPending}
                    title={
                      row.isActive
                        ? 'Deactivate — stops it being assigned; existing assignments are unchanged'
                        : 'Reactivate'
                    }
                    onClick={() => setActive.mutate({ id: row.id, isActive: !row.isActive })}
                  >
                    {row.isActive ? (
                      <PowerOff className="size-4" aria-hidden />
                    ) : (
                      <Power className="size-4" aria-hidden />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.name}`}
                    // An assigned structure cannot be deleted — the API refuses
                    // it too, but disabling says so before the click.
                    disabled={row.assignedCount > 0 || remove.isPending}
                    title={row.assignedCount > 0 ? 'In use — deactivate it instead' : undefined}
                    onClick={() => remove.mutate(row.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </>
              )
            : undefined
        }
      />
    </CrudShell>
  );
}
