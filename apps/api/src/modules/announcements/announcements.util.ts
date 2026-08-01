/**
 * Pure announcement rules — no Prisma, no I/O, fully unit-testable.
 * Audience targeting decides who may read a post, so it is kept here and
 * covered by tests rather than buried in a query.
 */

export type Audience = 'ALL' | 'DEPARTMENT' | 'LOCATION';

export interface AudienceSpec {
  audience: Audience;
  departmentId: string | null;
  locationId: string | null;
}

export interface Viewer {
  departmentId?: string | null;
  locationId?: string | null;
}

/** Does this post target this viewer? */
export function targetsViewer(spec: AudienceSpec, viewer: Viewer): boolean {
  switch (spec.audience) {
    case 'ALL':
      return true;
    case 'DEPARTMENT':
      // An untargeted department post would silently become org-wide
      return spec.departmentId != null && spec.departmentId === viewer.departmentId;
    case 'LOCATION':
      return spec.locationId != null && spec.locationId === viewer.locationId;
    default:
      return false;
  }
}

export interface Window {
  publishAt: Date;
  expiresAt: Date | null;
}

/** Scheduled posts stay hidden until publishAt; expired ones drop off. */
export function isLive(window: Window, now: Date): boolean {
  if (window.publishAt > now) return false;
  return window.expiresAt === null || window.expiresAt > now;
}

/** Readers see live, targeted posts; authors/managers see everything. */
export function isVisibleTo(
  post: AudienceSpec & Window,
  viewer: Viewer,
  now: Date,
  canManage: boolean,
): boolean {
  if (canManage) return true;
  return isLive(post, now) && targetsViewer(post, viewer);
}

/** Pinned first, then most recently published. */
export function feedOrder<T extends { isPinned: boolean; publishAt: Date }>(a: T, b: T): number {
  if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
  return b.publishAt.getTime() - a.publishAt.getTime();
}
