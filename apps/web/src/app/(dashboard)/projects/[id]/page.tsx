'use client';

import type { ProjectMemberCreateInput } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RowActions } from '@/components/crud/row-actions';
import { type Column, DataTable } from '@/components/data-table';
import { useSession } from '@/components/session-provider';
import { fullName } from '@/features/employees/types';
import { type ProjectMember, projectKeys, projectsApi } from '@/features/projects/api';
import { MemberFormDialog } from '@/features/projects/components/member-form';
import { ProjectStatusBadge, RolledOffBadge } from '@/features/projects/components/project-badges';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * One project, and who is on it.
 *
 * The staffing controls appear for HR *and* for the project's own manager —
 * the API grants the second without `project.manage`, and hiding the buttons
 * from somebody the API would let through is the mismatch this page has to
 * avoid.
 */
export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can, user } = useSession();
  const [editing, setEditing] = useState<ProjectMember | 'new' | null>(null);

  const query = useQuery({
    queryKey: projectKeys.one(id),
    queryFn: () => projectsApi.get(id),
  });

  const project = query.data;
  const canStaff =
    can('project.manage') ||
    (!!project && !!user?.employee && project.managerId === user.employee.id);

  const invalidate = [projectKeys.all()];

  const save = useApiMutation({
    mutationFn: (input: ProjectMemberCreateInput) =>
      editing && editing !== 'new'
        ? projectsApi.updateMember(editing.id, input)
        : projectsApi.addMember(id, input),
    invalidate,
    success: 'Saved',
    onSuccess: () => setEditing(null),
  });

  const remove = useApiMutation({
    mutationFn: (memberId: string) => projectsApi.removeMember(memberId),
    invalidate,
    success: 'Removed from the project',
  });

  const columns: Column<ProjectMember>[] = [
    {
      key: 'who',
      header: 'Who',
      alwaysVisible: true,
      render: (row) => (
        <span className="flex items-center gap-2">
          {row.employee ? fullName(row.employee) : '—'}
          {row.leftOn && <RolledOffBadge on={row.leftOn} />}
        </span>
      ),
    },
    { key: 'role', header: 'Role', render: (row) => row.role ?? '—' },
    {
      key: 'allocation',
      header: 'Allocation',
      render: (row) => <span className="tabular-nums">{row.allocation}%</span>,
    },
    {
      key: 'window',
      header: 'On the project',
      render: (row) => (
        <span className="tabular-nums text-sm">
          {row.joinedOn} → {row.leftOn ?? 'now'}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-3">
            {project?.name ?? 'Project'}
            {project && <ProjectStatusBadge status={project.status} />}
          </CardTitle>
          {canStaff && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden /> Add somebody
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Detail label="Code" value={project?.code} mono />
          <Detail label="Run by" value={project?.manager ? fullName(project.manager) : undefined} />
          <Detail
            label="Runs"
            value={project ? `${project.startsOn} → ${project.endsOn ?? 'open'}` : undefined}
          />
          <Detail
            label="Hours logged"
            // Not a count of hours — a count of entries, which is what blocks a
            // delete and what the refusal message names.
            value={project ? `${project.entryCount ?? 0} entries` : undefined}
          />
          {project?.description && (
            <p className="text-muted-foreground sm:col-span-2 lg:col-span-4">
              {project.description}
            </p>
          )}
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        rows={project?.members}
        rowKey={(row) => row.id}
        loading={query.isPending}
        error={query.isError}
        onRetry={() => query.refetch()}
        emptyTitle="Nobody is on this project yet"
        emptyHint="Only members can log hours against it, so this is the first thing to fill in."
        actions={
          canStaff
            ? (row) => (
                <RowActions
                  name={row.employee ? fullName(row.employee) : 'this member'}
                  editPerm="project.read.own"
                  deleting={remove.isPending}
                  onEdit={() => setEditing(row)}
                  onDelete={() => remove.mutate(row.id)}
                />
              )
            : undefined
        }
      />

      <MemberFormDialog
        open={editing !== null}
        member={editing === 'new' ? null : editing}
        submitting={save.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => save.mutate(values)}
      />
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className={mono ? 'font-mono text-xs' : undefined}>{value ?? '—'}</dd>
    </div>
  );
}
