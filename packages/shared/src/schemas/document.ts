import { z } from 'zod';

/**
 * Document folders are org-wide categories (Resume, PAN, …) that every
 * employee's files are filed under — a shared taxonomy, not per-person
 * folders, so HR can find the same document type across people.
 */
export const documentCategoryCreateSchema = z.object({
  name: z.string().trim().min(1, 'Folder name is required').max(60),
});
export const documentCategoryUpdateSchema = documentCategoryCreateSchema;
export type DocumentCategoryCreateInput = z.infer<typeof documentCategoryCreateSchema>;

export const documentQuerySchema = z.object({
  categoryId: z.string().optional(),
  search: z.string().trim().max(120).optional(),
});
export type DocumentQuery = z.infer<typeof documentQuerySchema>;

/** Moving a document between folders. */
export const documentMoveSchema = z.object({
  categoryId: z
    .string()
    .nullish()
    .or(z.literal('').transform(() => null)),
});
export type DocumentMoveInput = z.infer<typeof documentMoveSchema>;

/** Folder names seeded for a new organization (docs listed in the brief). */
export const DEFAULT_DOCUMENT_CATEGORIES = [
  'Resume',
  'Offer Letter',
  'PAN',
  'Aadhaar',
  'Certificates',
  'Bank Documents',
] as const;
