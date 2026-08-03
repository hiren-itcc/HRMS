'use client';

import { Button } from '@hrms/ui/components/button';
import { Skeleton } from '@hrms/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { FilePlus2, FileText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState } from '@/components/empty-state';
import { useSession } from '@/components/session-provider';
import { formatLetterDate, letterKeys, lettersApi } from '../api';
import { GenerateLetterDialog } from './generate-letter-dialog';
import { LetterStatusBadge } from './letter-status-badge';

interface Props {
  /** Omit for the signed-in person's own letters. */
  employeeId?: string;
  employeeName?: string;
}

/**
 * The letters filed against one person. Serves the employee record and the
 * self-service page from one component, so the two cannot drift — the same
 * arrangement DocumentsBrowser uses.
 */
export function LettersPanel({ employeeId, employeeName }: Props) {
  const { can } = useSession();
  const [generating, setGenerating] = useState(false);
  const isSelf = employeeId === undefined;

  const letters = useQuery({
    queryKey: isSelf ? letterKeys.mine() : letterKeys.forEmployee(employeeId),
    queryFn: () => (isSelf ? lettersApi.mine() : lettersApi.forEmployee(employeeId)),
  });

  const canIssue = !isSelf && can('letter.issue');
  const rows = letters.data ?? [];

  if (letters.isLoading) return <Skeleton className="h-32 w-full rounded-xl" />;

  return (
    <div className="space-y-3">
      {canIssue && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => setGenerating(true)}>
            <FilePlus2 className="size-4" aria-hidden /> Generate letter
          </Button>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No letters yet"
          hint={
            canIssue
              ? 'Offer, appointment, experience and salary letters appear here once issued.'
              : 'Letters issued to you will appear here.'
          }
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((letter) => (
            <li key={letter.id}>
              <Link
                href={`/letters/${letter.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:bg-accent/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-sm">{letter.title}</span>
                  <span className="block truncate font-mono text-muted-foreground text-xs">
                    {letter.letterNumber} · {formatLetterDate(letter.issuedAt)}
                  </span>
                </span>
                <LetterStatusBadge status={letter.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canIssue && (
        <GenerateLetterDialog
          employeeId={employeeId}
          employeeName={employeeName ?? 'this employee'}
          existing={rows}
          open={generating}
          onOpenChange={setGenerating}
        />
      )}
    </div>
  );
}
