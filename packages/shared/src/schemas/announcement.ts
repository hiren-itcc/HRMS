import { z } from 'zod';
import { paginationQuerySchema } from './common';

export const announcementCategorySchema = z.enum(['GENERAL', 'HOLIDAY', 'BIRTHDAY', 'POLICY']);
export const announcementPrioritySchema = z.enum(['NORMAL', 'HIGH', 'URGENT']);
export const audienceSchema = z.enum(['ALL', 'DEPARTMENT', 'LOCATION']);

const optionalId = z
  .string()
  .nullish()
  .or(z.literal('').transform(() => null));

const isoDateTime = z.string().datetime({ offset: true }).or(z.string().min(1));

/** Body is markdown — rendered without raw HTML, so posts cannot inject scripts. */
export const announcementCreateSchema = z
  .object({
    title: z.string().trim().min(3, 'Give the announcement a title').max(140),
    body: z.string().trim().min(1, 'Write something to announce').max(20_000),
    category: announcementCategorySchema.default('GENERAL'),
    priority: announcementPrioritySchema.default('NORMAL'),
    audience: audienceSchema.default('ALL'),
    departmentId: optionalId,
    locationId: optionalId,
    isPinned: z.boolean().default(false),
    publishAt: isoDateTime.optional(),
    expiresAt: isoDateTime.nullish().or(z.literal('').transform(() => null)),
  })
  .refine((d) => d.audience !== 'DEPARTMENT' || Boolean(d.departmentId), {
    path: ['departmentId'],
    message: 'Choose the department this is for',
  })
  .refine((d) => d.audience !== 'LOCATION' || Boolean(d.locationId), {
    path: ['locationId'],
    message: 'Choose the location this is for',
  })
  .refine((d) => !d.expiresAt || !d.publishAt || d.expiresAt > d.publishAt, {
    path: ['expiresAt'],
    message: 'Expiry must be after the publish date',
  });
export type AnnouncementCreateInput = z.infer<typeof announcementCreateSchema>;

/** Partial edit — the same cross-field rules are re-checked server-side. */
export const announcementUpdateSchema = z.object({
  title: z.string().trim().min(3).max(140).optional(),
  body: z.string().trim().min(1).max(20_000).optional(),
  category: announcementCategorySchema.optional(),
  priority: announcementPrioritySchema.optional(),
  audience: audienceSchema.optional(),
  departmentId: optionalId,
  locationId: optionalId,
  isPinned: z.boolean().optional(),
  publishAt: isoDateTime.optional(),
  expiresAt: isoDateTime.nullish().or(z.literal('').transform(() => null)),
});
export type AnnouncementUpdateInput = z.infer<typeof announcementUpdateSchema>;

export const announcementQuerySchema = paginationQuerySchema.extend({
  category: announcementCategorySchema.optional(),
  priority: announcementPrioritySchema.optional(),
  /** `unread` narrows to posts the caller has not opened yet. */
  filter: z.enum(['all', 'unread', 'pinned', 'mine']).default('all'),
});
export type AnnouncementQuery = z.infer<typeof announcementQuerySchema>;

export const ANNOUNCEMENT_CATEGORY_LABELS: Record<
  z.infer<typeof announcementCategorySchema>,
  string
> = {
  GENERAL: 'General',
  HOLIDAY: 'Holiday',
  BIRTHDAY: 'Birthday',
  POLICY: 'Policy',
};

export const ANNOUNCEMENT_PRIORITY_LABELS: Record<
  z.infer<typeof announcementPrioritySchema>,
  string
> = {
  NORMAL: 'Normal',
  HIGH: 'High',
  URGENT: 'Urgent',
};
