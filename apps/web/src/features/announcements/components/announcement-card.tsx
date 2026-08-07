'use client';

import { Badge } from '@hrms/ui/components/badge';
import { Card, CardContent } from '@hrms/ui/components/card';
import { cn } from '@hrms/ui/lib/utils';
import { CalendarClock, Download, Eye, Paperclip, Pencil, Pin, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { EmployeeAvatar } from '@/components/employee-avatar';
import { IconAction } from '@/components/icon-action';
import { type Announcement, announcementsApi, CATEGORY_STYLE, PRIORITY_STYLE } from '../api';
import { Markdown } from './markdown';

const dateFmt = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function initials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface CardProps {
  announcement: Announcement;
  canManage: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  onViewReads?: () => void;
  /** Compact drops the body — used by the dashboard widget. */
  compact?: boolean;
}

export function AnnouncementCard({
  announcement: a,
  canManage,
  onEdit,
  onDelete,
  onViewReads,
  compact = false,
}: CardProps) {
  const category = CATEGORY_STYLE[a.category];
  const priority = PRIORITY_STYLE[a.priority];

  const download = async (attachmentId: string, name: string) => {
    try {
      const blob = await announcementsApi.attachmentBlob(attachmentId);
      const href = URL.createObjectURL(blob);
      Object.assign(document.createElement('a'), { href, download: name }).click();
      URL.revokeObjectURL(href);
    } catch {
      toast.error('Could not download the attachment');
    }
  };

  return (
    <Card
      className={cn(
        'hover-lift relative overflow-hidden',
        a.isPinned && 'border-primary/40',
        !a.isRead && 'ring-1 ring-primary/25',
      )}
    >
      {/* Urgent posts get a colour rail — never colour alone, the badge repeats it */}
      {a.priority !== 'NORMAL' && (
        <span
          aria-hidden
          className={cn(
            'absolute inset-y-0 left-0 w-1',
            a.priority === 'URGENT' ? 'bg-destructive' : 'bg-warning',
          )}
        />
      )}
      <CardContent className={cn('space-y-3 py-5', a.priority !== 'NORMAL' && 'pl-6')}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {a.isPinned && (
                <Badge variant="outline" className="gap-1">
                  <Pin className="size-3" aria-hidden /> Pinned
                </Badge>
              )}
              <Badge className={cn('border-transparent', category.className)}>
                {category.label}
              </Badge>
              {a.priority !== 'NORMAL' && (
                <Badge className={cn('border-transparent', priority.className)}>
                  {priority.label}
                </Badge>
              )}
              {a.isScheduled && (
                <Badge variant="outline" className="gap-1">
                  <CalendarClock className="size-3" aria-hidden /> Scheduled
                </Badge>
              )}
              {a.isExpired && <Badge variant="outline">Expired</Badge>}
              {!a.isRead && !compact && (
                <span
                  role="status"
                  className="size-2 rounded-full bg-primary"
                  aria-label="Unread"
                />
              )}
            </div>
            {/* Linked so a post can be pointed at — the feed was the only way in. */}
            <h3 className="font-semibold text-base leading-snug">
              <Link href={`/announcements/${a.id}`} className="hover:underline">
                {a.title}
              </Link>
            </h3>
          </div>

          {canManage && (onEdit || onDelete || onViewReads) && (
            <div className="flex shrink-0 gap-0.5">
              {onViewReads && (
                <IconAction
                  label={`Read receipts for ${a.title}`}
                  icon={Eye}
                  size="icon"
                  onClick={onViewReads}
                />
              )}
              {onEdit && (
                <IconAction label={`Edit ${a.title}`} icon={Pencil} size="icon" onClick={onEdit} />
              )}
              {onDelete && (
                <IconAction
                  label={`Delete ${a.title}`}
                  icon={Trash2}
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={onDelete}
                />
              )}
            </div>
          )}
        </div>

        {!compact && <Markdown>{a.body}</Markdown>}

        {!compact && a.attachments.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {a.attachments.map((att) => (
              <li key={att.id}>
                <button
                  type="button"
                  onClick={() => download(att.id, att.name)}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors hover:border-primary/40 hover:bg-accent"
                >
                  <Paperclip className="size-3.5 text-muted-foreground" aria-hidden />
                  <span className="max-w-40 truncate">{att.name}</span>
                  <span className="text-muted-foreground">{formatBytes(att.sizeBytes)}</span>
                  <Download className="size-3.5 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
          <span className="flex items-center gap-1.5">
            <EmployeeAvatar
              src={a.author.avatarUrl}
              fallback={initials(a.author.name)}
              className="size-5"
              fallbackClassName="text-[9px]"
            />
            {a.author.name}
          </span>
          <span>· {dateFmt.format(new Date(a.publishAt))}</span>
          {a.audience !== 'ALL' && (
            <span className="flex items-center gap-1">
              · <Users className="size-3" aria-hidden />
              {a.audience === 'DEPARTMENT' ? 'Department' : 'Location'} only
            </span>
          )}
          {canManage && <span>· {a.readCount} read</span>}
          {compact && a.attachments.length > 0 && (
            <span className="flex items-center gap-1">
              · <Paperclip className="size-3" aria-hidden />
              {a.attachments.length}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
