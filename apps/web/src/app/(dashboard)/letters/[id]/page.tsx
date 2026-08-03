'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@hrms/ui/components/alert-dialog';
import { Button } from '@hrms/ui/components/button';
import { Input } from '@hrms/ui/components/input';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/error-state';
import { useSession } from '@/components/session-provider';
import { formatLetterDate, letterKeys, lettersApi } from '@/features/letters/api';
import { LetterFrame } from '@/features/letters/components/letter-frame';
import { ApiError } from '@/lib/api-client';

/**
 * The letter document.
 *
 * Print is the delivery mechanism rather than a server-generated PDF, exactly
 * as for payslips: the browser's own dialog produces a perfectly good file and
 * the letter stays inspectable rather than becoming an opaque binary.
 *
 * A void letter still renders. Someone holding the paper copy has no other way
 * to discover it was withdrawn, so hiding it would be the unhelpful choice.
 */
export default function LetterPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');

  const letter = useQuery({
    queryKey: letterKeys.one(id),
    queryFn: () => lettersApi.get(id),
  });

  const voidLetter = useMutation({
    mutationFn: () => lettersApi.void(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: letterKeys.all() });
      toast.success('Letter voided');
      setReason('');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not void the letter'),
  });

  if (letter.isError) return <ErrorState onRetry={() => letter.refetch()} />;
  if (!letter.data) return <Skeleton className="h-96 w-full rounded-xl" />;
  const l = letter.data;
  const isVoid = l.status === 'VOID';

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href="/documents/letters" />}
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </Button>
        <div className="flex flex-wrap gap-2">
          {can('letter.issue') && !isVoid && (
            <AlertDialog>
              <AlertDialogTrigger
                render={
                  <Button variant="outline" className="text-destructive hover:text-destructive" />
                }
              >
                <Ban className="size-4" aria-hidden /> Void
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Void {l.letterNumber}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The letter is kept and stays readable — a copy may already be in someone's
                    hands, so it is marked withdrawn rather than deleted. Say why.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Input
                  autoFocus
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Superseded by a revised offer"
                  aria-label="Reason for voiding"
                />
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground [background-image:none] hover:bg-destructive/90"
                    disabled={reason.trim() === '' || voidLetter.isPending}
                    onClick={() => voidLetter.mutate()}
                  >
                    Void letter
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden /> Print / save as PDF
          </Button>
        </div>
      </div>

      <article className="rounded-xl border bg-card p-6 print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
          <div>
            <h2 className="text-xl">{l.title}</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {l.employeeName} · {l.employeeCode} · issued {formatLetterDate(l.issuedAt)}
            </p>
          </div>
          <p className="font-mono text-muted-foreground text-sm">{l.letterNumber}</p>
        </header>

        {/* Deliberately not print:hidden — a withdrawn letter must print as one. */}
        {isVoid && (
          <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-destructive-foreground text-sm">
            <strong>This letter has been withdrawn</strong>
            {l.voidedAt && ` on ${formatLetterDate(l.voidedAt)}`}
            {l.voidReason && ` — ${l.voidReason}`}
          </p>
        )}

        <div className="pt-4">
          <LetterFrame html={l.bodyHtml} />
        </div>

        <p className="border-t pt-4 text-muted-foreground text-xs">
          Issued from the {l.templateKey.replace(/_/g, ' ')} template as it read on{' '}
          {formatLetterDate(l.issuedAt)}. Later edits to that template do not change this letter.
        </p>
      </article>
    </section>
  );
}
