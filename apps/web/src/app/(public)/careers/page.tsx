'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Card, CardContent } from '@hrms/ui/components/card';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { careersApi } from '@/features/careers/api';

export default function CareersPage() {
  const [search, setSearch] = useState('');

  const roles = useQuery({ queryKey: ['careers'], queryFn: careersApi.list });

  const needle = search.trim().toLowerCase();
  const shown = useMemo(() => {
    const all = roles.data ?? [];
    if (!needle) return all;
    return all.filter((role) =>
      `${role.title} ${role.department ?? ''} ${role.location ?? ''}`
        .toLowerCase()
        .includes(needle),
    );
  }, [roles.data, needle]);

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="font-semibold text-3xl">Open roles</h1>
        <p className="text-muted-foreground">
          Everything we are hiring for right now. Applying takes a couple of minutes.
        </p>
      </div>

      {roles.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}

      {/*
        A plain sentence rather than the dashboard's ErrorState: that component
        offers a retry and assumes a signed-in context, and somebody who cannot
        reach a job board does not need a diagnostic.
      */}
      {roles.isError && (
        <p className="text-muted-foreground">
          We could not load our open roles just now. Please try again shortly.
        </p>
      )}

      {roles.data && roles.data.length > 3 && (
        <div className="relative max-w-sm">
          <Search
            className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground"
            aria-hidden
          />
          <Input
            className="pl-8"
            placeholder="Search roles"
            aria-label="Search open roles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {roles.data && shown.length === 0 && (
        <p className="text-muted-foreground">
          {needle
            ? 'Nothing matches that search.'
            : 'We have no open roles at the moment. Do check back.'}
        </p>
      )}

      <div className="space-y-3">
        {shown.map((role) => (
          <Card key={role.slug} className="transition-shadow hover:shadow-md">
            <CardContent className="p-5">
              <Link href={`/careers/${role.slug}`} className="block space-y-2">
                <h2 className="font-medium text-lg hover:underline">{role.title}</h2>
                <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-sm">
                  {role.department && <Badge variant="outline">{role.department}</Badge>}
                  {role.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden />
                      {role.location}
                    </span>
                  )}
                  {role.employmentType && <span>· {role.employmentType}</span>}
                </div>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
