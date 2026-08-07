import { z } from 'zod';

/**
 * The public careers page — the only unauthenticated write surface in the
 * product.
 *
 * Everything else behind `/api/v1` requires a token, so every assumption the
 * rest of the codebase makes about a caller (they have an organization, a
 * permission set, an audit identity) is false here. That is the whole
 * difficulty, and it is a security task wearing a feature's clothes.
 */

/** A URL-safe slug: what the public sees instead of a cuid. */
export const openingSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Not a valid job link');

/**
 * `Senior Backend Engineer` → `senior-backend-engineer`.
 *
 * Deliberately drops everything that is not a letter or digit rather than
 * transliterating: a slug is an identifier, and a lossy one that is stable
 * beats a clever one that changes when somebody edits punctuation. The caller
 * is responsible for uniqueness — the column has a unique index per
 * organization and the service appends a counter.
 */
export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      // Combining marks, so "José" becomes "jose" rather than "jos-".
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
  );
}

/**
 * What somebody outside the company sends.
 *
 * Notice what is **not** here: no `source`, no `referrerId`, no notes, no
 * expected salary. Those are fields the hiring side fills in, and accepting
 * them from an anonymous form would let a stranger write their own referral
 * and attribution.
 */
export const careersApplySchema = z.object({
  firstName: z.string().trim().min(1, 'Tell us your first name').max(60),
  lastName: z.string().trim().min(1, 'Tell us your last name').max(60),
  email: z.email('That does not look like an email address').max(160),
  phone: z.string().trim().max(30).optional(),
  currentEmployer: z.string().trim().max(120).optional(),
  currentTitle: z.string().trim().max(120).optional(),
  /** Their word, in days — it is what a start date gets planned around. */
  noticePeriodDays: z.coerce.number().int().min(0).max(365).optional(),
  /** A short covering note. Length-capped because nothing here is trusted. */
  message: z.string().trim().max(2000).optional(),
});
export type CareersApplyInput = z.infer<typeof careersApplySchema>;

/**
 * What a role looks like to the outside world.
 *
 * Built field by field, and the internal opening is never spread into it. The
 * internal shape carries `minMonthlyCtc`, `maxMonthlyCtc`, the hiring manager
 * and the pipeline — spreading a row is how a salary band ends up on the open
 * internet.
 */
export interface PublicOpening {
  slug: string;
  title: string;
  department: string | null;
  location: string | null;
  employmentType: string | null;
  description: string | null;
  openedOn: string | null;
}
