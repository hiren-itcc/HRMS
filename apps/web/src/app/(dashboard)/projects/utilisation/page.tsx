'use client';

import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { fullName } from '@/features/employees/types';
import { projectKeys, projectsApi, type UtilisationReport } from '@/features/projects/api';

/**
 * Where the hours went.
 *
 * Draft and sent-back weeks are excluded by the API. A utilisation figure built
 * from hours nobody has stood behind changes the moment somebody finally opens
 * their timesheet, and this page is read as if it were settled — so the note
 * below says so rather than leaving it to be discovered.
 */

function isoBack(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

type EmployeeRow = UtilisationReport['byEmployee'][number];
type ProjectRow = UtilisationReport['byProject'][number];

export default function UtilisationPage() {
  const [from, setFrom] = useState(() => isoBack(28));
  const [to, setTo] = useState(today);
  const [range, setRange] = useState(() => ({ from: isoBack(28), to: today() }));

  const query = useQuery({
    queryKey: projectKeys.utilisation(range.from, range.to),
    queryFn: () => projectsApi.utilisation(range.from, range.to),
  });

  const people: Column<EmployeeRow>[] = [
    {
      key: 'who',
      header: 'Who',
      alwaysVisible: true,
      render: (row) => fullName(row.employee),
    },
    {
      key: 'hours',
      header: 'Hours',
      render: (row) => <span className="tabular-nums">{row.hours}</span>,
    },
    {
      key: 'utilisation',
      header: 'Of capacity',
      // Over 100% is shown rather than capped: over-allocation is real, and a
      // report that hides it is a report that never raises the alarm.
      render: (row) => <span className="tabular-nums">{row.utilisation}%</span>,
    },
  ];

  const projects: Column<ProjectRow>[] = [
    { key: 'code', header: 'Project', alwaysVisible: true, render: (row) => row.name },
    {
      key: 'codeText',
      header: 'Code',
      render: (row) => <span className="font-mono text-xs">{row.code}</span>,
    },
    {
      key: 'hours',
      header: 'Hours',
      render: (row) => <span className="tabular-nums">{row.hours}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setRange({ from, to });
        }}
      >
        <div className="space-y-1">
          <label htmlFor="from" className="font-medium text-sm">
            From
          </label>
          <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="to" className="font-medium text-sm">
            To
          </label>
          <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit">Show</Button>
      </form>

      <p className="text-muted-foreground text-sm">
        Submitted and approved weeks only, against {query.data?.capacityHours ?? 0} hours of
        full-time capacity over {query.data?.days ?? 0} days. Drafts are excluded — they are not
        hours anybody has stood behind yet.
      </p>

      {query.isError && (
        <p className="text-destructive-text text-sm">
          That range could not be loaded — a year is the most this report will cover.{' '}
          <button type="button" className="underline" onClick={() => query.refetch()}>
            Try again
          </button>
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By person</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={people}
              rows={query.data?.byEmployee}
              rowKey={(row) => row.employeeId}
              loading={query.isPending}
              emptyTitle="No hours in this range"
              emptyHint="Nobody has had a week approved or submitted covering these dates."
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>By project</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={projects}
              rows={query.data?.byProject}
              rowKey={(row) => row.projectId}
              loading={query.isPending}
              emptyTitle="No hours in this range"
              emptyHint="Hours appear here once a week covering these dates is submitted."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
