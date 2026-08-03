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
 * How sure the reading was, shown only when it was not sure.
 *
 * Deliberately quiet: a conclusive punch gets no chip at all, because
 * decorating every ordinary day with a green tick trains people to stop
 * reading them. What is worth saying is when the mode beside it is a guess —
 * the reading straddled the geofence, or there was no reading, or no office
 * has been put on the map. None of that is an accusation, and it is not
 * phrased as one.
 */
export function VerificationChip({ session }: { session: DaySession }) {
  if (session.verification !== 'UNVERIFIED') return null;
  // The measurement, when there was one, is the useful half of "not sure".
  const measured =
    session.distanceMeters !== null && session.officeName
      ? ` · ${formatDistance(session.distanceMeters)} from ${session.officeName}`
      : '';
  return (
    <Badge className="border-transparent bg-muted text-muted-foreground">
      <TriangleAlert className="size-3" aria-hidden /> Location not confirmed{measured}
    </Badge>
  );
}
