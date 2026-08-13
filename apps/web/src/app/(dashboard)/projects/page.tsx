'use client';

import { PROJECT_STATUS_LABELS, PROJECT_STATUSES, type ProjectCreateInput } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { fullName } from '@/features/employees/types';
import { type Project, projectKeys, projectsApi } from '@/features/projects/api';
import { ProjectStatusBadge } from '@/features/projects/components/project-badges';
import { ProjectFormDialog } from '@/features/projects/components/project-form';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * The register.
 *
 * `scope` is the whole access story on this screen: somebody with
 * `project.read` sees every project, and everybody else sees the ones they are
 * on or run. The API decides that — asking for `all` without the permission
 * quietly returns `own` rather than failing.
 */
export default function ProjectsPage() {
  const { can } = useSession();
  const canReadAll = can('project.read');
  const canManage = can('project.manage');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);

  const params = {
    page: 1,
    limit: 50,
    scope: canReadAll ? ('all' as const) : ('own' as const),
  };

  const query = useQuery({
    queryKey: projectKeys.list(params),
    queryFn: () => projectsApi.list(params),
  });

  const invalidate = [projectKeys.all()];

  const save = useApiMutation({
    mutationFn: (input: ProjectCreateInput) =>
      editing && editing !== 'new'
        ? projectsApi.update(editing.id, input)
        : projectsApi.create(input),
    invalidate,
    success: 'Project saved',
    onSuccess: () => setEditing(null),
  });

  const remove = useApiMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    invalidate,
    success: 'Project deleted',
  });

  const columns: Column<Project>[] = [
    {
      key: 'name',
      header: 'Project',
      alwaysVisible: true,
      render: (row) => (
        <Link href={`/projects/${row.id}`} className="font-medium hover:underline">
          {row.name}
        </Link>
      ),
    },
    {
      key: 'code',
      header: 'Code',
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => <ProjectStatusBadge status={row.status} />,
    },
    {
      key: 'manager',
      header: 'Run by',
      render: (row) => (row.manager ? fullName(row.manager) : '—'),
    },
    {
      key: 'dates',
      header: 'Runs',
      render: (row) => (
        <span className="tabular-nums text-sm">
          {row.startsOn} → {row.endsOn ?? 'open'}
        </span>
      ),
    },
    {
      key: 'members',
      header: 'People',
      render: (row) => <span className="tabular-nums">{row.memberCount ?? 0}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" aria-hidden /> Open a project
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        rows={query.data?.data}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle={canReadAll ? 'No projects yet' : 'You are not on a project'}
        emptyHint={
          canReadAll
            ? 'A project is a named piece of work people log their hours against.'
            : 'Once somebody staffs you onto one, it appears here and on your timesheet.'
        }
        actions={
          canManage
            ? (row) => (
                <RowActions
                  name={row.name}
                  editPerm="project.read.own"
                  deleting={remove.isPending}
                  onEdit={() => setEditing(row)}
                  onDelete={() => remove.mutate(row.id)}
                />
              )
            : undefined
        }
      />

      {/* Deliberately not a filter row: the register is small enough to read,
          and the status badge already says which are live. */}
      {query.data && query.data.data.length > 0 && (
        <p className="text-muted-foreground text-sm">
          {PROJECT_STATUSES.filter((status) => query.data.data.some((row) => row.status === status))
            .map(
              (status) =>
                `${query.data.data.filter((row) => row.status === status).length} ${PROJECT_STATUS_LABELS[status].toLowerCase()}`,
            )
            .join(' · ')}
        </p>
      )}

      <ProjectFormDialog
        open={editing !== null}
        project={editing === 'new' ? null : editing}
        submitting={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => save.mutate(values)}
      />
    </div>
  );
}
