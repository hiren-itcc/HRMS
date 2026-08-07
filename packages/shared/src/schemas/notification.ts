import { z } from 'zod';
import { paginationQuerySchema } from './common';

/**
 * In-app notifications.
 *
 * The `Notification` table has existed since the first migration and has never
 * been read or written — doc 15 lists it as dead schema. This is the module it
 * was reserved for.
 *
 * Nothing here is org-scoped, and that is deliberate rather than an oversight:
 * a notification belongs to one user, a user belongs to one organization, and
 * the two other user-owned tables in the schema (`RefreshSession`,
 * `PasswordResetToken`) carry no `organizationId` for the same reason. Scoping
 * on `userId` from the JWT subject is strictly tighter than scoping on the org.
 */

export const notificationQuerySchema = paginationQuerySchema.extend({
  /** Only what has not been read. The bell's default view. */
  unreadOnly: z.coerce.boolean().optional(),
});
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;

/**
 * The shape every sender builds.
 *
 * `type` is dot-namespaced the way audit actions are — `resignation.submitted`,
 * `offboarding.completed` — so a family can be filtered or styled without a
 * second column, and so a new one needs no migration.
 *
 * `linkPath` is where pressing the notification lands. A notification that
 * tells you something happened and gives you no way to reach it is a worse
 * version of no notification at all.
 */
export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  linkPath?: string | null;
}

/**
 * Whether the bell is also an email.
 *
 * Per person, and the organization has its own switch — `EmailTemplate.isActive`
 * on `notification_generic` in Settings. Either one being off stops the mail;
 * neither affects the bell. Password resets and invites ignore both, because an
 * account nobody can get back into is not a preference anybody expressed.
 */
export const notificationPreferencesSchema = z.object({
  emailNotifications: z.boolean(),
});
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>;

export interface NotificationEntry {
  id: string;
  type: string;
  title: string;
  body: string | null;
  linkPath: string | null;
  readAt: string | null;
  createdAt: string;
}
