'use client';

import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { relativeTime } from '@/features/settings/audit-api';
import type { TicketComment } from '../types';
import { InternalNoteBadge } from './ticket-badges';

/**
 * The conversation.
 *
 * Three kinds render three ways, and the differences are the point rather than
 * decoration:
 *
 * - **Public** — an ordinary reply, from either side.
 * - **Internal** — visible only to the desk, and labelled in words. The
 *   requester never receives one; the API drops it from the payload entirely.
 *   The label is for the agent, who needs to know at a glance which entries the
 *   other person can read. A background tint alone is what somebody skimming
 *   misses, so it gets a badge that says so.
 * - **System** — what this module has instead of a status-history table.
 *   Centred, small, and authorless, because nobody wrote it.
 */
export function TicketThread({ comments }: { comments: TicketComment[] }) {
  if (comments.length === 0) {
    return (
      <p className="py-8 text-center text-muted-foreground text-sm">
        Nothing yet. The desk will reply here, and you will get an email when they do.
      </p>
    );
  }

  return (
    <ol className="space-y-4">
      {comments.map((comment) => {
        const when = relativeTime(comment.createdAt);

        if (comment.kind === 'SYSTEM') {
          return (
            <li key={comment.id} className="flex items-center justify-center gap-2">
              <span className="text-muted-foreground text-xs">
                {comment.body} · {when}
              </span>
            </li>
          );
        }

        return (
          <li
            key={comment.id}
            className={cn(
              'rounded-lg border p-4',
              comment.kind === 'INTERNAL' && 'border-warning/40 bg-warning/5',
            )}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="font-medium text-sm">{comment.author?.name ?? 'Someone'}</span>
              <span className="text-muted-foreground text-xs">{when}</span>
              {comment.kind === 'INTERNAL' && <InternalNoteBadge />}
            </div>
            {/* Plain text, deliberately: the body is whatever somebody typed,
                and rendering it as markup would make a ticket an injection
                surface that anybody in the company can write to. */}
            <p className="whitespace-pre-wrap text-sm">{comment.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

/** The one-line facts above the thread. */
export function TicketFacts({ items }: { items: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-muted-foreground text-xs">{item.label}</dt>
          <dd className="mt-0.5 text-sm">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyBadge({ children }: { children: React.ReactNode }) {
  return <Badge variant="outline">{children}</Badge>;
}
