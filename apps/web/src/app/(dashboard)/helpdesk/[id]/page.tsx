'use client';

import { TICKET_PRIORITIES } from '@hrms/shared';
import { Button } from '@hrms/ui/components/button';
import { Card, CardContent, CardHeader, CardTitle } from '@hrms/ui/components/card';
import { Textarea } from '@hrms/ui/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Lock, Send } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { ErrorState } from '@/components/error-state';
import { helpdeskApi, helpdeskKeys } from '@/features/helpdesk/api';
import {
  TicketAgeBadge,
  TicketPriorityBadge,
  TicketStatusBadge,
} from '@/features/helpdesk/components/ticket-badges';
import { TicketFacts, TicketThread } from '@/features/helpdesk/components/ticket-thread';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * One ticket.
 *
 * Every control on this page is rendered from a `can*` flag the API returned,
 * never from the status. The server folds "does the status permit this" and
 * "is this reader allowed to do it" into one answer, so a button that appears
 * here cannot be one the service would then refuse — and the state machine
 * stays written down in exactly one place.
 */
export default function TicketPage() {
  const { id } = useParams<{ id: string }>();
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [waitNote, setWaitNote] = useState('');

  const query = useQuery({
    queryKey: helpdeskKeys.ticket(id),
    queryFn: () => helpdeskApi.get(id),
  });
  const ticket = query.data;

  const after = () => {
    setReply('');
    setInternal(false);
    setResolution('');
    setWaitNote('');
  };
  const comment = useApiMutation({
    mutationFn: () => helpdeskApi.comment(id, { body: reply, internal }),
    invalidate: [helpdeskKeys.all()],
    success: internal ? 'Note saved' : 'Reply sent',
    onSuccess: after,
  });
  const start = useApiMutation({
    mutationFn: () => helpdeskApi.start(id),
    invalidate: [helpdeskKeys.all()],
    success: 'Picked up',
  });
  const resolve = useApiMutation({
    mutationFn: () => helpdeskApi.resolve(id, { resolution }),
    invalidate: [helpdeskKeys.all()],
    success: 'Resolved',
    onSuccess: after,
  });
  const wait = useApiMutation({
    mutationFn: () => helpdeskApi.wait(id, { note: waitNote }),
    invalidate: [helpdeskKeys.all()],
    success: 'Waiting on them',
    onSuccess: after,
  });
  const close = useApiMutation({
    mutationFn: () => helpdeskApi.close(id),
    invalidate: [helpdeskKeys.all()],
    success: 'Closed',
  });
  const reopen = useApiMutation({
    mutationFn: () => helpdeskApi.reopen(id),
    invalidate: [helpdeskKeys.all()],
    success: 'Reopened',
  });
  const cancel = useApiMutation({
    mutationFn: () => helpdeskApi.cancel(id, {}),
    invalidate: [helpdeskKeys.all()],
    success: 'Cancelled',
  });
  const setPriority = useApiMutation({
    mutationFn: (priority: (typeof TICKET_PRIORITIES)[number]) =>
      helpdeskApi.setPriority(id, priority),
    invalidate: [helpdeskKeys.all()],
    success: 'Priority updated',
  });

  if (query.isError) {
    return (
      <ErrorState
        title="This ticket did not load"
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (!ticket) return <p className="text-muted-foreground text-sm">Loading…</p>;

  return (
    <div className="space-y-6">
      <Link
        href="/helpdesk"
        className="inline-flex items-center gap-1 text-muted-foreground text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden /> All tickets
      </Link>

      <Card>
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <TicketStatusBadge
              status={ticket.status}
              /* The desk's wording when the reader can act on it. */
              audience={ticket.canResolve || ticket.canAssign ? 'agent' : 'requester'}
            />
            <TicketPriorityBadge priority={ticket.priority} />
            <TicketAgeBadge days={ticket.ageDays} />
          </div>
          <CardTitle>{ticket.subject}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TicketFacts
            items={[
              { label: 'Desk', value: ticket.category?.name ?? '—' },
              { label: 'Raised by', value: ticket.requester?.name ?? '—' },
              { label: 'With', value: ticket.assignee?.name ?? 'Nobody yet' },
              {
                label: 'Raised',
                value: new Date(ticket.createdAt).toLocaleDateString('en-IN'),
              },
            ]}
          />
          <p className="whitespace-pre-wrap text-sm">{ticket.description}</p>
          {ticket.resolution && (
            <div className="rounded-md border border-success/40 bg-success/5 p-3">
              <p className="font-medium text-sm">What was done</p>
              <p className="mt-1 whitespace-pre-wrap text-sm">{ticket.resolution}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <TicketThread comments={ticket.comments ?? []} />

          {ticket.canComment && (
            <div className="space-y-2 border-t pt-4">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={internal ? 'A note only the desk can see' : 'Write a reply'}
                rows={4}
                aria-label={internal ? 'Internal note' : 'Reply'}
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                {/* Rendered only for the desk — an internal note is not a thing
                    the requester can even be offered. */}
                {ticket.canAddInternalNote && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(e) => setInternal(e.target.checked)}
                    />
                    <Lock className="size-3.5" aria-hidden />
                    Internal note — the person who raised this will not see it
                  </label>
                )}
                <Button
                  onClick={() => comment.mutate(undefined)}
                  disabled={!reply.trim() || comment.isPending}
                  className="ms-auto"
                >
                  <Send className="size-4" aria-hidden /> {internal ? 'Save note' : 'Reply'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(ticket.canStart ||
        ticket.canWaitOnRequester ||
        ticket.canResolve ||
        ticket.canClose ||
        ticket.canReopen ||
        ticket.canCancel ||
        ticket.canSetPriority) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">What happens next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ticket.canSetPriority && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-sm">Priority</span>
                {TICKET_PRIORITIES.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={ticket.priority === p ? 'default' : 'outline'}
                    onClick={() => setPriority.mutate(p)}
                  >
                    {p.toLowerCase()}
                  </Button>
                ))}
              </div>
            )}

            {ticket.canWaitOnRequester && (
              <div className="space-y-2">
                <Textarea
                  value={waitNote}
                  onChange={(e) => setWaitNote(e.target.value)}
                  placeholder="What do you need from them? They will see this and get an email."
                  rows={3}
                  aria-label="What you need from them"
                />
                <Button
                  variant="outline"
                  onClick={() => wait.mutate(undefined)}
                  disabled={!waitNote.trim() || wait.isPending}
                >
                  Put on hold pending their answer
                </Button>
              </div>
            )}

            {ticket.canResolve && (
              <div className="space-y-2">
                <Textarea
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  placeholder="What did you actually do? This is what they will read."
                  rows={3}
                  aria-label="What was done"
                />
                <Button
                  onClick={() => resolve.mutate(undefined)}
                  disabled={!resolution.trim() || resolve.isPending}
                >
                  Resolve
                </Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {ticket.canStart && (
                <Button variant="outline" onClick={() => start.mutate(undefined)}>
                  Pick this up
                </Button>
              )}
              {ticket.canClose && (
                <Button variant="outline" onClick={() => close.mutate(undefined)}>
                  That is sorted — close it
                </Button>
              )}
              {ticket.canReopen && (
                <Button variant="outline" onClick={() => reopen.mutate(undefined)}>
                  That did not fix it
                </Button>
              )}
              {ticket.canCancel && (
                <Button variant="ghost" onClick={() => cancel.mutate(undefined)}>
                  Withdraw
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
