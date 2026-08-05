import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

export const auditQuerySchema = paginationQuerySchema.extend({
  /** Model name, e.g. "Employee" or "LeaveRequest". */
  entity: z.string().trim().max(64).optional(),
  /**
   * One row's id. `AuditLog` has always been indexed on `[entity, entityId]`
   * but there was no way to ask for it — so "everything that happened to this
   * employee" meant paging the whole trail and filtering in the browser.
   */
  entityId: z.string().trim().max(64).optional(),
  actorId: z.string().trim().max(64).optional(),
  /** Exact action, e.g. "leave.request.approved". */
  action: z.string().trim().max(64).optional(),
  /** Action family, e.g. "leave" — matches every leave.* action. */
  resource: z.string().trim().max(32).optional(),
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
});
export type AuditQuery = z.infer<typeof auditQuerySchema>;

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  meta: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
  /** Null for system actions and for users deleted since the event. */
  actor: { id: string; email: string; name: string | null } | null;
}
