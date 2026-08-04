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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, LogOut, Monitor, Smartphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { FadeInItem, Stagger } from '@/components/motion';
import { useSession } from '@/components/session-provider';
import { type ActiveSession, authApi } from '@/features/auth/api';
import { ApiError } from '@/lib/api-client';

/**
 * The devices that can still refresh this account (screen 14, docs/05).
 *
 * "Still able to refresh" is the honest definition of a live session here:
 * rotated ones are excluded, or a refresh every fifteen minutes would bury the
 * list under a hundred entries a day, all of them the same browser.
 */

/** Enough of the user-agent to recognise a device, without pretending to parse it. */
function describeDevice(userAgent: string | null): { label: string; mobile: boolean } {
  if (!userAgent) return { label: 'Unknown device', mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(userAgent);
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : 'Browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /Mac OS X|Macintosh/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad|iOS/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return { label: os ? `${browser} on ${os}` : browser, mobile };
}

function SessionRow({
  session,
  onRevoke,
  pending,
}: {
  session: ActiveSession;
  onRevoke: (id: string) => void;
  pending: boolean;
}) {
  const { label, mobile } = describeDevice(session.userAgent);
  const Icon = mobile ? Smartphone : Monitor;

  return (
    <li className="flex items-center justify-between gap-4 border-b py-4 last:border-b-0">
      <div className="flex min-w-0 items-center gap-3">
        <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-medium text-sm">
            <span className="truncate">{label}</span>
            {session.isCurrent && <Badge variant="secondary">This device</Badge>}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {session.ip ?? 'Unknown address'} · signed in{' '}
            {new Date(session.createdAt).toLocaleString()}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => onRevoke(session.id)}
        aria-label={session.isCurrent ? 'Sign out this device' : `Sign out ${label}`}
      >
        <LogOut aria-hidden className="size-4" />
        Sign out
      </Button>
    </li>
  );
}

export default function SessionsPage() {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const router = useRouter();

  const sessions = useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: authApi.sessions,
    enabled: Boolean(user),
  });

  const revoke = useMutation({
    mutationFn: authApi.revokeSession,
    onSuccess: (_result, id) => {
      const wasCurrent = sessions.data?.find((s) => s.id === id)?.isCurrent;
      if (wasCurrent) {
        // The API cleared the cookie, so this browser can no longer refresh.
        // Staying on the page would work until the access token expires and
        // then fail silently — send them to sign in while it is explicable.
        toast.success('Signed out on this device');
        router.replace('/login');
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
      toast.success('That device has been signed out');
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Could not sign that device out'),
  });

  if (!user) return null;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" className="-ml-2" render={<Link href="/profile" />}>
          <ArrowLeft aria-hidden className="size-4" />
          My profile
        </Button>
        <div>
          <h1>Active sessions</h1>
          <p className="text-muted-foreground text-sm">
            Where you are signed in. Sign out any device you do not recognise.
          </p>
        </div>
      </div>

      <Stagger>
        <FadeInItem>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Devices</CardTitle>
              <CardDescription>
                Signing out a device ends its session immediately. It does not change your password
                — if you suspect someone else has it, change that too.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {sessions.isPending ? (
                <div className="space-y-4">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : sessions.isError ? (
                <p className="text-destructive-text text-sm">
                  Could not load your sessions.{' '}
                  <button type="button" className="underline" onClick={() => sessions.refetch()}>
                    Try again
                  </button>
                </p>
              ) : sessions.data?.length ? (
                <ul>
                  {sessions.data.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      pending={revoke.isPending}
                      onRevoke={revoke.mutate}
                    />
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No active sessions.</p>
              )}
            </CardContent>
          </Card>
        </FadeInItem>
      </Stagger>
    </div>
  );
}
