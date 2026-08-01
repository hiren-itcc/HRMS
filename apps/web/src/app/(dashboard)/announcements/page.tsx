'use client';

import { ANNOUNCEMENT_CATEGORY_LABELS } from '@hrms/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@hrms/ui/components/alert-dialog';
import { Button } from '@hrms/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@hrms/ui/components/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@hrms/ui/components/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@hrms/ui/components/select';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { cn } from '@hrms/ui/lib/utils';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CheckCheck, Megaphone, Plus, Search, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { type Announcement, announcementsApi } from '@/features/announcements/api';
import { AnnouncementCard } from '@/features/announcements/components/announcement-card';
import { ComposeDialog } from '@/features/announcements/components/compose-dialog';
import { useListParams } from '@/hooks/use-list-params';
import { ApiError } from '@/lib/api-client';

const ALL = 'all';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'pinned', label: 'Pinned' },
  { value: 'mine', label: 'Mine' },
] as const;

const readFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

function AnnouncementsView() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const params = useListParams('publishAt');
  const reduce = useReducedMotion();
  const canManage = can('announcement.manage');

  const filter = params.get('filter') ?? 'all';
  const category = params.get('category');
  const [searchInput, setSearchInput] = useState(params.search);
  const [composeOpen, setComposeOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [receiptsFor, setReceiptsFor] = useState<Announcement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== params.search) params.setSearch(searchInput);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, params]);

  const feed = useQuery({
    queryKey: ['announcements', filter, category, params.search, params.page],
    queryFn: () =>
      announcementsApi.list({
        filter,
        category,
        search: params.search,
        page: params.page,
        limit: 10,
      }),
  });

  const receipts = useQuery({
    queryKey: ['announcements', 'reads', receiptsFor?.id],
    queryFn: () => announcementsApi.reads(receiptsFor?.id ?? ''),
    enabled: Boolean(receiptsFor),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['announcements'] });

  const markAllRead = useMutation({
    mutationFn: announcementsApi.markAllRead,
    onSuccess: (r) => {
      invalidate();
      toast.success(r.marked > 0 ? `${r.marked} marked as read` : 'Nothing new to read');
    },
  });

  const remove = useMutation({
    mutationFn: announcementsApi.remove,
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success('Announcement deleted');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not delete'),
  });

  // Opening the feed marks what you can see as read
  const markRead = useMutation({ mutationFn: announcementsApi.markRead });
  useEffect(() => {
    const unread = feed.data?.data.filter((a) => !a.isRead && !a.isScheduled) ?? [];
    if (unread.length === 0) return;
    const t = setTimeout(() => {
      Promise.all(unread.map((a) => markRead.mutateAsync(a.id).catch(() => undefined))).then(() =>
        queryClient.invalidateQueries({ queryKey: ['announcements', 'unread'] }),
      );
    }, 1200);
    return () => clearTimeout(t);
  }, [feed.data, markRead, queryClient]);

  const rows = feed.data?.data ?? [];

  return (
    <Stagger className="space-y-6">
      <FadeInItem>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1>Announcements</h1>
            <p className="text-muted-foreground text-sm">Company news, policies and celebrations</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="size-4" aria-hidden /> Mark all read
            </Button>
            {canManage && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setComposeOpen(true);
                }}
              >
                <Plus className="size-4" aria-hidden /> New announcement
              </Button>
            )}
          </div>
        </div>
      </FadeInItem>

      <FadeInItem className="flex flex-wrap items-center gap-2">
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => params.setFilter('filter', f.value === 'all' ? undefined : f.value)}
              className={cn(
                'rounded-lg px-3.5 py-1.5 text-sm transition-colors',
                filter === f.value
                  ? 'bg-card font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Select
          value={category ?? ALL}
          onValueChange={(v) => params.setFilter('category', v === ALL ? undefined : v)}
        >
          <SelectTrigger className="w-40" aria-label="Filter by category">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {Object.entries(ANNOUNCEMENT_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* InputGroup, not an icon absolutely positioned over a padded
            input: the input's own bg-background painted over the icon in
            light mode, which is why it only showed in dark. */}
        <InputGroup className="w-full max-w-xs">
          <InputGroupAddon>
            <Search className="size-4" aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search announcements…"
            aria-label="Search announcements"
          />
          {searchInput && (
            <InputGroupAddon align="inline-end">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>
      </FadeInItem>

      <FadeInItem className="space-y-4">
        {feed.isLoading &&
          [1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-2xl" />)}

        {!feed.isLoading && rows.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed py-16 text-center">
            <Megaphone className="size-8 text-muted-foreground/50" aria-hidden />
            <p className="font-medium text-sm">
              {params.search ? `Nothing matches “${params.search}”` : 'No announcements yet'}
            </p>
            <p className="text-muted-foreground text-xs">
              {canManage
                ? 'Post the first one to keep everyone in the loop.'
                : 'Company news will appear here.'}
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {rows.map((a) => (
            <motion.div
              key={a.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
              transition={{ duration: 0.2 }}
            >
              <AnnouncementCard
                announcement={a}
                canManage={canManage}
                onEdit={() => {
                  setEditing(a);
                  setComposeOpen(true);
                }}
                onDelete={() => setDeleting(a)}
                onViewReads={() => setReceiptsFor(a)}
              />
            </motion.div>
          ))}
        </AnimatePresence>

        {feed.data && feed.data.meta.total > feed.data.meta.limit && (
          <div className="flex items-center justify-between">
            <p className="text-muted-foreground text-sm tabular-nums">
              {feed.data.meta.total} announcements
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={params.page <= 1}
                onClick={() => params.setPage(params.page - 1)}
              >
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={params.page * feed.data.meta.limit >= feed.data.meta.total}
                onClick={() => params.setPage(params.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </FadeInItem>

      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} editing={editing} />

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{deleting?.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The announcement and its attachments are removed for everyone. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground [background-image:none] hover:bg-destructive/90"
              disabled={remove.isPending}
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={receiptsFor !== null} onOpenChange={(o) => !o && setReceiptsFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">Read receipts</DialogTitle>
            <DialogDescription className="truncate">{receiptsFor?.title}</DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-1">
            {receipts.isLoading && <Skeleton className="h-24 w-full rounded-xl" />}
            {receipts.data?.length === 0 && (
              <p className="py-6 text-center text-muted-foreground text-sm">
                Nobody has opened this yet.
              </p>
            )}
            {receipts.data?.map((r) => (
              <div
                key={r.userId}
                className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-sm">{r.name}</p>
                  {r.email && <p className="truncate text-muted-foreground text-xs">{r.email}</p>}
                </div>
                <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                  {readFmt.format(new Date(r.readAt))}
                </span>
              </div>
            ))}
          </DialogPanel>
        </DialogContent>
      </Dialog>
    </Stagger>
  );
}

export default function AnnouncementsPage() {
  return (
    <Suspense>
      <AnnouncementsView />
    </Suspense>
  );
}
