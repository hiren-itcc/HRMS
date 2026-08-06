'use client';

import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { EmptyState } from '@/components/empty-state';
import { NoAccess } from '@/components/no-access';
import { useSession } from '@/components/session-provider';
import { directoryApi, directoryKeys, fullName, initials } from '@/features/directory/api';

function Detail({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null | undefined;
  href?: string;
}) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <p className="text-muted-foreground text-xs uppercase tracking-wider">{label}</p>
        {href ? (
          <a className="break-words text-sm hover:underline" href={href}>
            {value}
          </a>
        ) : (
          <p className="break-words text-sm">{value}</p>
        )}
      </div>
    </div>
  );
}

export default function DirectoryProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { can, status } = useSession();
  const canRead = can('directory.read');

  const person = useQuery({
    queryKey: directoryKeys.profile(id),
    queryFn: () => directoryApi.profile(id),
    enabled: canRead,
    retry: false,
  });

  if (status === 'authenticated' && !canRead) return <NoAccess what="the company directory" />;
  if (person.isLoading) return <Skeleton className="h-80 w-full rounded-xl" />;
  if (person.isError || !person.data) {
    return (
      <EmptyState
        icon={UserRound}
        title="Nobody to show"
        hint="This person is not in the directory."
        className="py-24"
        action={
          <Button variant="outline" render={<Link href="/directory" />}>
            Back to the directory
          </Button>
        }
      />
    );
  }

  const p = person.data;

  return (
    <section className="max-w-2xl space-y-4">
      <Button variant="ghost" size="sm" render={<Link href="/directory" />}>
        <ArrowLeft className="size-4" aria-hidden /> Directory
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <EmployeeAvatar
              src={p.avatarUrl}
              fallback={initials(p)}
              className="size-16"
              fallbackClassName="text-lg"
            />
            <div className="min-w-0">
              <CardTitle className="text-xl">{fullName(p)}</CardTitle>
              <p className="text-muted-foreground text-sm">
                {p.designation?.title ?? 'Team member'}
                {p.department && ` · ${p.department.name}`}
              </p>
              <p className="text-muted-foreground text-xs">{p.employeeCode}</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Detail
            icon={Mail}
            label="Work email"
            value={p.workEmail}
            href={`mailto:${p.workEmail}`}
          />
          <Detail
            icon={Phone}
            label="Work phone"
            value={p.phone}
            href={p.phone ? `tel:${p.phone}` : undefined}
          />
          <Detail icon={Building2} label="Department" value={p.department?.name} />
          <Detail icon={MapPin} label="Location" value={p.location?.name} />
          {p.manager && (
            <div className="flex items-start gap-3">
              <UserRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
              <div className="min-w-0">
                <p className="text-muted-foreground text-xs uppercase tracking-wider">Reports to</p>
                <Link href={`/directory/${p.manager.id}`} className="text-sm hover:underline">
                  {fullName(p.manager)}
                </Link>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/*
        Said plainly rather than left as an absence: someone looking for a
        colleague's home address should know it is not withheld by accident.
      */}
      <p className="text-muted-foreground text-xs">
        The directory shows work contact details only. Personal information, pay and HR records are
        not shown here.
      </p>
    </section>
  );
}
