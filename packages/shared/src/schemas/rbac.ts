import { z } from 'zod';

/**
 * A role code: capitals, digits and underscores, and **permanent once
 * created**.
 *
 * Immutable for a harder reason than a pay component's code. The access token
 * carries `roleCode`, not a role id, so renaming a code would leave every
 * session already signed in naming a role that no longer exists — and the
 * roles editor identifies the caller's own row by comparing that claim. A
 * rename would silently re-point the self-edit refusal at the wrong role.
 */
export const roleCodeShape = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(20)
  .regex(/^[A-Z][A-Z0-9_]*$/, 'Use capitals, digits and underscores, starting with a letter');

export const roleCreateSchema = z.object({
  code: roleCodeShape,
  name: z.string().trim().min(1, 'Name is required').max(60),
  description: z.string().trim().max(200).optional().nullable(),
  /**
   * Optional starting grants. Subject to the same escalation ceiling as the
   * roles editor — a caller cannot seed a new role with a permission they do
   * not hold themselves, which would otherwise be the ceiling's back door.
   */
  permissions: z.array(z.string()).max(200).default([]),
});

/**
 * `code` is deliberately absent — see `roleCodeShape`. `isSystem` is absent
 * too: it is set by the seed and describes what a role *is*, not something an
 * operator chooses.
 */
export const roleUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(60).optional(),
  description: z.string().trim().max(200).optional().nullable(),
});

export type RoleCreateInput = z.infer<typeof roleCreateSchema>;
export type RoleUpdateInput = z.infer<typeof roleUpdateSchema>;
