'use client';

import { Alert, AlertDescription, AlertTitle } from '@hrms/ui/components/alert';
import { Badge } from '@hrms/ui/components/badge';
import { Button } from '@hrms/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@hrms/ui/components/card';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSession } from '@/components/session-provider';
import { onboardingApi, onboardingKeys } from '@/features/onboarding/api';
import { ApiError } from '@/lib/api-client';

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * The invitation, on the employee's own record.
 *
 * Renders nothing for an ordinary employee — it only exists while somebody is
 * mid-onboarding. Its job is to answer the two questions HR actually asks:
 * where did the invitation go, and can I send it again?
 */
export function InviteCard({ employeeId }: { employeeId: string }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [lastError, setLastError] = useState<string | null>(null);

  const invite = useQuery({
    queryKey: onboardingKeys.invite(employeeId),
    queryFn: () => onboardingApi.inviteStatus(employeeId),
  });

  const resend = useMutation({
    mutationFn: () => onboardingApi.resendInvite(employeeId),
    onSuccess: (result) => {
      // all() covers the invite key now that it lives under 'onboarding'.
      queryClient.invalidateQueries({ queryKey: onboardingKeys.all() });
      if (result.inviteSent) {
        setLastError(null);
        toast.success('Invitation sent — the previous link no longer works');
      } else {
        setLastError(result.inviteError ?? 'The email provider rejected the message');
        toast.error('The invitation still did not go out');
      }
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not resend the invitation'),
  });

  // Not onboarding — nothing to show.
  if (!invite.data) return null;
  const s = invite.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              Invitation
              {s.accepted ? (
                <Badge variant="success">Accepted</Badge>
              ) : s.expired ? (
                <Badge variant="destructive">Expired</Badge>
              ) : (
                <Badge variant="warning">Awaiting acceptance</Badge>
              )}
            </CardTitle>
            <CardDescription>
              {s.accepted
                ? 'They have set their password and started onboarding'
                : 'They set their own password through the link — no password is ever emailed'}
            </CardDescription>
          </div>
          {s.canResend && can('employee.invite') && (
            <Button variant="outline" disabled={resend.isPending} onClick={() => resend.mutate()}>
              {resend.isPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Send className="size-4" aria-hidden />
              )}
              Resend invitation
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Sent to</dt>
            <dd className="font-medium">{s.lastSentTo ?? s.personalEmail ?? '—'}</dd>
          </div>
          {s.lastSentAt && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Sent</dt>
              <dd className="tabular-nums">{dateFmt.format(new Date(s.lastSentAt))}</dd>
            </div>
          )}
          {s.expiresAt && !s.accepted && (
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Link expires</dt>
              <dd className="tabular-nums">{dateFmt.format(new Date(s.expiresAt))}</dd>
            </div>
          )}
        </dl>

        {lastError && (
          <Alert variant="error">
            <AlertTriangle aria-hidden />
            <AlertTitle>The email was rejected</AlertTitle>
            <AlertDescription>{lastError}</AlertDescription>
          </Alert>
        )}

        {s.onboardingStatus === 'SUBMITTED' && (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/employees/onboarding/${s.onboardingId}`} />}
          >
            Review their submission
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
