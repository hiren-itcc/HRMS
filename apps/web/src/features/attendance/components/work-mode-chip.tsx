import { Badge } from '@hrms/ui/components/badge';
import { cn } from '@hrms/ui/lib/utils';
import { Building2, Home, MapPin, TriangleAlert } from 'lucide-react';
import { type DaySession, formatDistance, WORK_MODE_LABEL, type WorkMode } from '../api';

const MODE_ICON = { OFFICE: Building2, REMOTE: Home, CLIENT_SITE: MapPin } as const;

/** Where a sitting was worked. Colours follow the attendance status palette. */
export function WorkModeChip({ mode, className }: { mode: WorkMode; className?: string }) {
  const Icon = MODE_ICON[mode];
  return (
    <Badge className={cn('border-transparent bg-muted text-muted-foreground', className)}>
      <Icon className="size-3" aria-hidden /> {WORK_MODE_LABEL[mode]}
    </Badge>
  );
}

/**
 * The verdict on an office claim, shown only when there is something to say.
 *
 * Deliberately quiet: a verified punch gets no chip at all, because decorating
 * every ordinary day with a green tick trains people to stop reading. Only
 * "we could not check" and "this does not match" are worth a person's
 * attention, and neither is phrased as an accusation.
 */
export function VerificationChip({ session }: { session: DaySession }) {
  if (session.workMode !== 'OFFICE') return null;

  if (session.verification === 'OUTSIDE') {
    return (
      <Badge className="border-transparent bg-warning/15 text-warning-text">
        <TriangleAlert className="size-3" aria-hidden />
        {session.officeName
          ? `${formatDistance(session.distanceMeters)} from ${session.officeName}`
          : formatDistance(session.distanceMeters)}
      </Badge>
    );
  }
  if (session.verification === 'UNVERIFIED') {
    return (
      <Badge className="border-transparent bg-muted text-muted-foreground">
        Location not shared
      </Badge>
    );
  }
  return null;
}
