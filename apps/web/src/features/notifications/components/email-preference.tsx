'use client';

import { Skeleton } from '@hrms/ui/components/skeleton';
import { Switch } from '@hrms/ui/components/switch';
import { useQuery } from '@tanstack/react-query';
import { notificationKeys, notificationsApi } from '@/features/notifications/api';
import { useApiMutation } from '@/hooks/use-crud';

/**
 * Whether the bell is also an email.
 *
 * One of two switches, and either being off stops the mail: this one, and the
 * organization's, which is the `Notification` template in Settings → Email.
 * Neither touches password resets or invites — an account nobody can get back
 * into is not a preference anybody expressed.
 *
 * Saves on change rather than behind a Save button. It is a single boolean with
 * nothing to validate against, and a form around one switch is a form somebody
 * leaves half-finished.
 */
export function EmailNotificationPreference() {
  const preferences = useQuery({
    queryKey: notificationKeys.preferences(),
    queryFn: notificationsApi.preferences,
  });

  const save = useApiMutation({
    mutationFn: (emailNotifications: boolean) =>
      notificationsApi.updatePreferences({ emailNotifications }),
    invalidate: [notificationKeys.preferences()],
    success: (data) =>
      data.emailNotifications ? 'Email notifications on' : 'Email notifications off',
    error: 'That setting could not be saved',
  });

  if (preferences.isLoading) return <Skeleton className="h-6 w-full" />;
  // No row, no switch. A failed read is not a reason to show a control whose
  // position would be a guess.
  if (!preferences.data) return null;

  return (
    <div className="flex items-start gap-3">
      <Switch
        id="email-notifications"
        checked={preferences.data.emailNotifications}
        disabled={save.isPending}
        onCheckedChange={(next) => save.mutate(next)}
      />
      <div className="space-y-0.5">
        <label htmlFor="email-notifications" className="font-medium text-sm">
          Email me my notifications
        </label>
        <p className="text-muted-foreground text-xs">
          Approvals, resignations and exits reach you by email as well as the bell. Password resets
          and invitations are always sent.
        </p>
      </div>
    </div>
  );
}
