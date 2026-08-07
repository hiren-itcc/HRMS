'use client';

import { Button } from '@hrms/ui/components/button';
import { Card, CardContent } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Mail, Search, Users } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { EmptyState } from '@/components/empty-state';
import { FadeInItem, Stagger } from '@/components/motion';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import {
  type DirectoryCard,
  directoryApi,
  directoryKeys,
  fullName,
  initials,
} from '@/features/directory/api';
import { useListParams } from '@/hooks/use-list-params';

function PersonCard({ person }: { person: DirectoryCard }) {
  return (
    <Link
      href={`/directory/${person.id}`}
      className="rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/24"
    >
      <Card className="hover-lift h-full">
        <CardContent className="flex items-start gap-3 p-4">
          <EmployeeAvatar
            src={person.avatarUrl}
            fallback={initials(person)}
            className="size-11"
            fallbackClassName="text-sm"
          />
          <div className="min-w-0 space-y-0.5">
            <p className="truncate font-medium text-sm">{fullName(person)}</p>
            <p className="truncate text-muted-foreground text-xs">
              {person.designation?.title ?? person.employeeCode}
            </p>
            {person.department && (
              <p className="truncate text-muted-foreground text-xs">{person.department.name}</p>
            )}
            <p className="flex items-center gap-1.5 truncate pt-1 text-muted-foreground text-xs">
              <Mail className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{person.workEmail}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function DirectoryView() {
  const params = useListParams('firstName');
  const query = { page: params.page, limit: 24, search: params.search, sort: params.sort };

  const people = useQuery({
    queryKey: directoryKeys.list(query),
    queryFn: () => directoryApi.list(query),
  });

  const meta = people.data?.meta;
  const hasMore = meta ? meta.page * meta.limit < meta.total : false;

  return (
    <Stagger className="space-y-5">
      <FadeInItem>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2>Directory</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              Everyone at the company and how to reach them
            </p>
          </div>
          <div className="relative w-full sm:w-72">
            <Search
              className="-translate-y-1/2 absolute top-1/2 left-3 size-4 text-muted-foreground"
              aria-hidden
            />
            <Input
              className="pl-9"
              placeholder="Search by name, code or email"
              aria-label="Search the directory"
              defaultValue={params.search}
              onChange={(e) => params.setSearch(e.target.value)}
            />
          </div>
        </div>
      </FadeInItem>

      {people.isLoading && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
          {Array.from({ length: 8 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length skeleton
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      )}

      {people.isError && (
        <EmptyState
          icon={Users}
          title="Could not load the directory"
          hint="Something went wrong on our side."
          className="py-16"
          action={<Button onClick={() => people.refetch()}>Try again</Button>}
        />
      )}

      {people.data &&
        (people.data.data.length === 0 ? (
          <EmptyState
            icon={Users}
            title={params.search ? 'Nobody matches that search' : 'Nobody to show yet'}
            hint={
              params.search
                ? 'Try a name, employee code or work email.'
                : 'People appear here once they join.'
            }
            className="py-16"
          />
        ) : (
          <FadeInItem>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
              {people.data.data.map((person) => (
                <PersonCard key={person.id} person={person} />
              ))}
            </div>
          </FadeInItem>
        ))}

      {meta && meta.total > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            Showing {(meta.page - 1) * meta.limit + 1}–
            {Math.min(meta.page * meta.limit, meta.total)} of {meta.total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => params.setPage(meta.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={() => params.setPage(meta.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Stagger>
  );
}

export default function DirectoryPage() {
  const { can, status } = useSession();
  if (status === 'authenticated' && !can('directory.read')) {
    return <NoAccess what="the company directory" />;
  }
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <DirectoryView />
    </Suspense>
  );
}
