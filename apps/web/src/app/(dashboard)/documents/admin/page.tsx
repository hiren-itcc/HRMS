'use client';

import { Button } from '@hrms/ui/components/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Download, Eye } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { CrudShell } from '@/components/crud/crud-shell';
import { type Column, DataTable } from '@/components/data-table';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import {
  type AdminDocument,
  documentsApi,
  fileKindLabel,
  formatBytes,
  isPreviewable,
} from '@/features/documents/api';
import { DocumentPreview } from '@/features/documents/components/document-preview';
import { employeesApi } from '@/features/employees/api';
import { useOptions } from '@/hooks/use-crud';
import { useListParams } from '@/hooks/use-list-params';

const ALL = '__all__';
const PAGE_SIZE = 20;

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Every employee's documents in one list — the HR question the per-employee
 * browser cannot answer ("who is missing a PAN card?"). Behind `document.read`,
 * which only HR and Admin hold; `.team` holders are refused rather than
 * silently narrowed, because a filtered answer to "show me everything" would
 * be a different question wearing the same name.
 */
function DocumentAdminTable() {
  const params = useListParams('createdAt');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const employeeId = params.get('employeeId');
  const categoryId = params.get('categoryId');

  const employees = useOptions(
    'employees',
    employeesApi.options,
    (e) => `${e.firstName} ${e.lastName}`,
  );
  const folders = useQuery({
    queryKey: ['documents', 'folders', 'org'],
    queryFn: () => documentsApi.folders(),
  });

  const list = useQuery({
    queryKey: ['documents', 'all', { employeeId, categoryId, q: params.search, page: params.page }],
    queryFn: () =>
      documentsApi.listAll({
        employeeId,
        categoryId,
        search: params.search || undefined,
        page: params.page,
        limit: PAGE_SIZE,
      }),
    // Keeps the previous page on screen while the next one loads, so paging
    // does not flash an empty table.
    placeholderData: keepPreviousData,
  });

  const rows = list.data?.data ?? [];

  const columns: Column<AdminDocument>[] = [
    {
      key: 'employee',
      header: 'Employee',
      alwaysVisible: true,
      render: (d) =>
        d.employee ? (
          <Link href={`/employees/${d.employee.id}`} className="min-w-0 hover:underline">
            <span className="block truncate font-medium">
              {d.employee.firstName} {d.employee.lastName}
            </span>
            <span className="block truncate font-mono text-muted-foreground text-xs">
              {d.employee.employeeCode}
            </span>
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'name',
      header: 'Document',
      render: (d) => (
        <span className="min-w-0">
          <span className="block truncate">{d.name}</span>
          <span className="block text-muted-foreground text-xs">{fileKindLabel(d.mimeType)}</span>
        </span>
      ),
    },
    {
      key: 'folder',
      header: 'Folder',
      className: 'hidden md:table-cell',
      render: (d) => d.category?.name ?? '—',
    },
    {
      key: 'sizeBytes',
      header: 'Size',
      className: 'hidden lg:table-cell',
      render: (d) => <span className="tabular-nums">{formatBytes(d.sizeBytes)}</span>,
    },
    {
      key: 'createdAt',
      header: 'Uploaded',
      className: 'hidden sm:table-cell',
      render: (d) => <span className="tabular-nums">{dateFmt.format(new Date(d.createdAt))}</span>,
    },
  ];

  async function download(doc: AdminDocument) {
    const blob = await documentsApi.fileBlob(doc.id);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <CrudShell
        title="All employees"
        description="Every personnel file in the organization"
        search={params.search}
        onSearchChange={params.setSearch}
        filters={
          <>
            <Select
              value={employeeId ?? ALL}
              onValueChange={(v) => params.setFilter('employeeId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-48" aria-label="Filter by employee">
                <SelectValue placeholder="All employees" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All employees</SelectItem>
                {employees.options?.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={categoryId ?? ALL}
              onValueChange={(v) => params.setFilter('categoryId', v === ALL ? undefined : v)}
            >
              <SelectTrigger className="w-40" aria-label="Filter by folder">
                <SelectValue placeholder="All folders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All folders</SelectItem>
                {folders.data?.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(d) => d.id}
          loading={list.isLoading}
          meta={list.data?.meta}
          onPageChange={params.setPage}
          emptyTitle="No documents found"
          emptyHint="Adjust the filters, or ask the employee to upload one."
          error={list.isError}
          onRetry={() => list.refetch()}
          actions={(d) => (
            <div className="flex justify-end gap-1">
              {isPreviewable(d.mimeType) && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Preview ${d.name}`}
                  onClick={() => setPreviewIndex(rows.indexOf(d))}
                >
                  <Eye className="size-4" aria-hidden />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${d.name}`}
                onClick={() => download(d)}
              >
                <Download className="size-4" aria-hidden />
              </Button>
            </div>
          )}
        />
      </CrudShell>

      <DocumentPreview documents={rows} index={previewIndex} onIndexChange={setPreviewIndex} />
    </>
  );
}

export default function DocumentAdminPage() {
  const { can, status } = useSession();

  if (status === 'authenticated' && !can('document.read')) {
    return <NoAccess what="documents across the organization" />;
  }
  return <DocumentAdminTable />;
}
