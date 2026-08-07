import type { NotificationsService } from './notifications.service';

/**
 * Notifications stub for service specs.
 *
 * Every sender is fire-and-forget and swallows its own errors, so nothing
 * under test depends on what these return — the double exists so a spec can
 * assert *who* was told what, which is the part worth pinning.
 */
export interface NotificationsDouble extends NotificationsService {
  notify: jest.Mock;
  notifyPermission: jest.Mock;
}

export function notificationsDouble(): NotificationsDouble {
  return {
    notify: jest.fn().mockResolvedValue(undefined),
    notifyPermission: jest.fn().mockResolvedValue(undefined),
  } as unknown as NotificationsDouble;
}
