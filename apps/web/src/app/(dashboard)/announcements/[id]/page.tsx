'use client';

import { ANNOUNCEMENT_CATEGORY_LABELS } from '@hrms/shared';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Paperclip, Pin } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ErrorState } from '@/components/error-state';
import { announcementsApi } from '@/features/announcements/api';

/**
 * One announcement on its own page, so a post can be linked to.
 *
 * `GET /announcements/:id` shipped with the module and nothing called it — the
 * feed held every post and there was no way to point at one. Audience filtering
 * is applied by the API, so a post addressed to another department 404s here
 * exactly as it is absent from the feed.
 */
export default function AnnouncementPage() {
  const { id } = useParams<{ id: string }>();
  const query = useQuery({
    queryKey: ['announcements', 'detail', id],
    queryFn: () => announcementsApi.detail(id),
  });

  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (!query.data) return <Skeleton className="h-64 w-full rounded-xl" />;
  const a = query.data;

  return (
    <article className="space-y-4">
      <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/announcements" />}>
        <ArrowLeft className="size-4" aria-hidden /> All announcements
      </Button>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {a.isPinned && (
            <Badge variant="secondary">
              <Pin className="size-3" aria-hidden /> Pinned
            </Badge>
          )}
          <Badge variant="outline">{ANNOUNCEMENT_CATEGORY_LABELS[a.category] ?? a.category}</Badge>
          {a.priority !== 'NORMAL' && (
            <Badge variant={a.priority === 'URGENT' ? 'error' : 'warning'}>
              {a.priority.toLowerCase()}
            </Badge>
          )}
          {a.isScheduled && <Badge variant="info">Scheduled</Badge>}
        </div>
        <h1>{a.title}</h1>
        <p className="text-muted-foreground text-sm">
          {new Date(a.publishAt).toLocaleString()}
          {a.expiresAt && ` · expires ${new Date(a.expiresAt).toLocaleDateString()}`}
        </p>
      </header>

      <div className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{a.body}</ReactMarkdown>
      </div>

      {a.attachments.length > 0 && (
        <section className="space-y-2 border-t pt-4">
          <h2 className="font-medium text-sm">Attachments</h2>
          <ul className="space-y-1">
            {a.attachments.map((att) => (
              <li key={att.id} className="flex items-center gap-2 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{att.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
