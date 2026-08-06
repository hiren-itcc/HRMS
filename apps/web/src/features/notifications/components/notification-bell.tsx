'use client';

import { Button } from '@hrms/ui/components/button';
import { Popover, PopoverPopup, PopoverTrigger } from '@hrms/ui/components/popover';
import { ScrollArea } from '@hrms/ui/components/scroll-area';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@hrms/ui/components/tooltip';
import { cn } from '@hrms/ui/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { useApiMutation } from '@/hooks/use-crud';
import { type NotificationEntry, notificationKeys, notificationsApi } from '../api';

/** How often the badge refreshes. Doc 03 specified 30s before the module was dropped. */
const POLL_MS = 30_000;
const PAGE = { page: 1, limit: 15 };

/** "just now" / "5 minutes ago" / "3 days ago", from a timestamp. */
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

function ago(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

function Row({
  entry,
  onOpen,
}: {
  entry: NotificationEntry;
  onOpen: (entry: NotificationEntry) => void;
}) {
  const unread = entry.readAt === null;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(entry)}
        className={cn(
          'flex w-full gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60',
          'focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2',
        )}
      >
        {/*
         * Unread is a dot *and* a weight change, never colour alone — and the
         * screen-reader text says which, because the dot is decorative.
         */}
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            unread ? 'bg-primary' : 'bg-transparent',
          )}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span className={cn('block text-sm', unread ? 'font-medium' : 'text-muted-foreground')}>
            {entry.title}
          </span>
          {entry.body && (
            <span className="mt-0.5 block text-muted-foreground text-xs">{entry.body}</span>
          )}
          <span className="mt-0.5 block text-muted-foreground text-xs">
            <time dateTime={entry.createdAt}>{ago(entry.createdAt)}</time>
            {unread && <span className="sr-only"> — unread</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The bell.
 *
 * The badge polls on its own; the list is only fetched while the popover is
 * open, so a session that never opens it costs one count query every thirty
 * seconds and nothing else.
 */
export function NotificationBell() {
  const { status } = useSession();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();

  const authed = status === 'authenticated';

  const unread = useQuery({
    queryKey: notificationKeys.unread(),
    queryFn: notificationsApi.unreadCount,
    enabled: authed,
    refetchInterval: POLL_MS,
    // Polling is the point; a stale count is the thing being avoided.
    staleTime: 0,
  });

  const list = useQuery({
    queryKey: notificationKeys.list(PAGE),
    queryFn: () => notificationsApi.list(PAGE),
    enabled: authed && open,
  });

  const invalidate = [notificationKeys.all()];
  const markRead = useApiMutation({ mutationFn: notificationsApi.markRead, invalidate });
  const markAll = useApiMutation({
    mutationFn: notificationsApi.markAllRead,
    invalidate,
    success: 'All caught up',
    error: 'Could not mark them read',
  });

  const count = unread.data?.unread ?? 0;

  const openEntry = (entry: NotificationEntry) => {
    if (entry.readAt === null) markRead.mutate(entry.id);
    if (entry.linkPath) {
      setOpen(false);
      router.push(entry.linkPath);
    }
  };

  if (!authed) return null;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Opening should show what the badge is counting, not a cached list
        // from the last time it was opened.
        if (next) queryClient.invalidateQueries({ queryKey: notificationKeys.list(PAGE) });
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
                />
              }
            />
          }
        >
          <Bell className="size-4.5" aria-hidden />
          {count > 0 && (
            <span
              className="-top-0.5 -right-0.5 absolute flex min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground tabular-nums"
              aria-hidden
            >
              {count > 9 ? '9+' : count}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent>
          {count > 0 ? `Notifications — ${count} unread` : 'Notifications'}
        </TooltipContent>
      </Tooltip>

      <PopoverPopup align="end" className="w-80 flex-col p-0 sm:w-96">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <p className="font-medium text-sm">Notifications</p>
          {count > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </Button>
          )}
        </div>

        {list.isPending ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState className="m-3" onRetry={() => list.refetch()} />
        ) : list.data?.data.length ? (
          <ScrollArea className="max-h-96">
            <ul className="divide-y">
              {list.data.data.map((entry) => (
                <Row key={entry.id} entry={entry} onOpen={openEntry} />
              ))}
            </ul>
          </ScrollArea>
        ) : (
          /* Quiet text, not the full EmptyState block — this is a 320px popover. */
          <p className="px-3 py-8 text-center text-muted-foreground text-sm">
            Nothing yet. You will hear about resignations, approvals and exits here.
          </p>
        )}
      </PopoverPopup>
    </Popover>
  );
}
