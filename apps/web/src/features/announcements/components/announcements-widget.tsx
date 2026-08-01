'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Megaphone, Pin } from 'lucide-react';
import Link from 'next/link';
import { announcementsApi, CATEGORY_STYLE, PRIORITY_STYLE } from '../api';

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });

/** Latest announcements for the employee dashboard. */
export function AnnouncementsWidget() {
  const feed = useQuery({
    queryKey: ['announcements', 'widget'],
    queryFn: () => announcementsApi.list({ page: 1, limit: 4 }),
    staleTime: 30_000,
  });

  const unread = useQuery({
    queryKey: ['announcements', 'unread'],
    queryFn: announcementsApi.unreadCount,
    staleTime: 30_000,
  });

  const rows = feed.data?.data ?? [];

  return (
    <Card className="hover-lift">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Megaphone className="size-4 text-muted-foreground" aria-hidden />
              Announcements
              {(unread.data?.unread ?? 0) > 0 && (
                <Badge className="border-transparent bg-primary text-primary-foreground">
                  {unread.data?.unread} new
                </Badge>
              )}
            </CardTitle>
            <CardDescription>Latest company news</CardDescription>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/announcements">
              View all <ArrowRight className="size-4" aria-hidden />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {feed.isLoading && [1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}

        {!feed.isLoading && rows.length === 0 && (
          <p className="py-6 text-center text-muted-foreground text-sm">No announcements yet.</p>
        )}

        {rows.map((a) => (
          <Link
            key={a.id}
            href="/announcements"
            className="flex items-start gap-3 rounded-xl border p-3 transition-colors hover:border-primary/40 hover:bg-accent"
          >
            <span
              aria-hidden
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                a.isRead ? 'bg-transparent' : 'bg-primary',
              )}
            />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {a.isPinned && <Pin className="size-3 text-muted-foreground" aria-hidden />}
                <span className="truncate font-medium text-sm">{a.title}</span>
              </span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <Badge
                  className={cn(
                    'border-transparent text-[10px]',
                    CATEGORY_STYLE[a.category].className,
                  )}
                >
                  {CATEGORY_STYLE[a.category].label}
                </Badge>
                {a.priority !== 'NORMAL' && (
                  <Badge
                    className={cn(
                      'border-transparent text-[10px]',
                      PRIORITY_STYLE[a.priority].className,
                    )}
                  >
                    {PRIORITY_STYLE[a.priority].label}
                  </Badge>
                )}
                <span className="text-muted-foreground text-xs">
                  {dateFmt.format(new Date(a.publishAt))}
                </span>
              </span>
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
