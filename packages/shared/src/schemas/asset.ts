import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

/**
 * The asset register: one row per physical thing, not a stock count.
 *
 * Per-item is what makes "who has SN-4471" answerable, and it is the only
 * shape under which an exit can be blocked on a *specific* laptop rather than
 * on a number somebody has to reconcile by hand.
 */

export const ASSET_STATUSES = ['IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'LOST', 'RETIRED'] as const;
export const assetStatusSchema = z.enum(ASSET_STATUSES);
export type AssetStatusCode = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatusCode, string> = {
  IN_STOCK: 'In stock',
  ASSIGNED: 'Issued',
  IN_REPAIR: 'In repair',
  LOST: 'Lost',
  RETIRED: 'Retired',
};

export const ASSET_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
export const assetConditionSchema = z.enum(ASSET_CONDITIONS);
export type AssetConditionCode = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CONDITION_LABELS: Record<AssetConditionCode, string> = {
  NEW: 'New',
  GOOD: 'Good',
  FAIR: 'Fair',
  POOR: 'Poor',
  DAMAGED: 'Damaged',
};

/**
 * The statuses an organization sets by hand.
 *
 * `ASSIGNED` is deliberately absent: that is what issuing *means*, and letting
 * somebody type it would let the status and the assignment history disagree.
 *
 * `IN_STOCK` is here, and its first draft was not — which made repair a
 * dead end. `canSetStatus` allowed `IN_REPAIR → IN_STOCK` while this enum
 * refused it, so an asset sent to the vendor could never come back, and the
 * refusal on issuing one said "put it back in stock before issuing it" — advice
 * the API made impossible to follow. Moving *to* `IN_STOCK` from a held asset is
 * still refused, by the rule rather than by the enum.
 */
export const ASSET_MANUAL_STATUSES = ['IN_STOCK', 'IN_REPAIR', 'LOST', 'RETIRED'] as const;
export const assetManualStatusSchema = z.enum(ASSET_MANUAL_STATUSES);
export type AssetManualStatusCode = (typeof ASSET_MANUAL_STATUSES)[number];

/** Categories seeded for a new organization, like DEFAULT_DOCUMENT_CATEGORIES. */
export const DEFAULT_ASSET_CATEGORIES = [
  'Laptop',
  'Desktop',
  'Monitor',
  'Mobile phone',
  'SIM card',
  'Access card',
  'Headset',
  'Furniture',
] as const;

const tag = z
  .string()
  .trim()
  .min(1, 'Give it an asset tag')
  .max(40)
  // Printed on a sticker and read back by a human, so the characters that
  // survive a label printer and a phone camera, and nothing else.
  .regex(/^[A-Za-z0-9][A-Za-z0-9/-]*$/, 'Letters, numbers, hyphens and slashes only');

export const assetCreateSchema = z.object({
  categoryId: z.string().trim().min(1, 'Pick a category').max(40),
  assetTag: tag,
  name: z.string().trim().min(1, 'Give it a name').max(120),
  serialNumber: z.string().trim().max(80).optional().nullable(),
  make: z.string().trim().max(80).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  condition: assetConditionSchema.default('GOOD'),
  purchaseDate: dateOnlySchema.optional().nullable(),
  purchaseCost: z.number().min(0).max(99_999_999.99).optional().nullable(),
  warrantyEnd: dateOnlySchema.optional().nullable(),
  vendor: z.string().trim().max(120).optional().nullable(),
  locationId: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});
export type AssetCreateInput = z.infer<typeof assetCreateSchema>;

/** Status is absent on purpose — it moves through issue, return or the status
 *  route, never through a general edit. */
export const assetUpdateSchema = assetCreateSchema.partial();
export type AssetUpdateInput = z.infer<typeof assetUpdateSchema>;

export const assetIssueSchema = z.object({
  employeeId: z.string().trim().min(1, 'Pick who it goes to').max(40),
  issuedOn: dateOnlySchema,
  conditionOut: assetConditionSchema.default('GOOD'),
  notes: z.string().trim().max(500).optional().nullable(),
});
export type AssetIssueInput = z.infer<typeof assetIssueSchema>;

export const assetReturnSchema = z.object({
  returnedOn: dateOnlySchema,
  /** Recorded so "it came back scratched" is on the record, not an argument. */
  conditionIn: assetConditionSchema,
  notes: z.string().trim().max(500).optional().nullable(),
});
export type AssetReturnInput = z.infer<typeof assetReturnSchema>;

/** Marking one lost or retired is a claim somebody should have to justify. */
export const assetStatusChangeSchema = z.object({
  status: assetManualStatusSchema,
  reason: z.string().trim().min(3, 'Say why').max(500),
});
export type AssetStatusChangeInput = z.infer<typeof assetStatusChangeSchema>;

export const assetCategorySchema = z.object({
  name: z.string().trim().min(1, 'Give the category a name').max(60),
});
export type AssetCategoryInput = z.infer<typeof assetCategorySchema>;

export const assetQuerySchema = paginationQuerySchema.extend({
  status: assetStatusSchema.optional(),
  categoryId: z.string().trim().max(40).optional(),
  employeeId: z.string().trim().max(40).optional(),
  /** Matches asset tag, serial or name — the three things somebody reads off
   *  a sticker when they are holding the thing. */
  search: z.string().trim().max(80).optional(),
});
export type AssetQuery = z.infer<typeof assetQuerySchema>;
