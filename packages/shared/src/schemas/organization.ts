import { z } from 'zod';
import { dateOnlySchema, paginationQuerySchema } from './common';

const name = z.string().trim().min(1, 'Name is required').max(100);
const optionalCode = z
  .string()
  .trim()
  .max(20)
  .optional()
  .or(z.literal('').transform(() => undefined));
const timeHHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24h HH:MM');

// ── Company ───────────────────────────────────────────────────────────
export const companyUpdateSchema = z.object({
  name: name.optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  logoUrl: z
    .url()
    .nullish()
    .or(z.literal('').transform(() => null)),
});
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

// ── Departments ───────────────────────────────────────────────────────
export const departmentCreateSchema = z.object({
  name,
  code: optionalCode,
  parentId: z
    .string()
    .nullish()
    .or(z.literal('').transform(() => null)),
});
export const departmentUpdateSchema = departmentCreateSchema.partial();
export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;
export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

// ── Designations ──────────────────────────────────────────────────────
export const designationCreateSchema = z.object({
  title: name,
  level: z.coerce.number().int().min(0).max(20).default(0),
});
export const designationUpdateSchema = designationCreateSchema.partial();
export type DesignationCreateInput = z.infer<typeof designationCreateSchema>;
export type DesignationUpdateInput = z.infer<typeof designationUpdateSchema>;

// ── Employment types ──────────────────────────────────────────────────
export const employmentTypeCreateSchema = z.object({
  name,
  code: optionalCode,
});
export const employmentTypeUpdateSchema = employmentTypeCreateSchema.partial();
export type EmploymentTypeCreateInput = z.infer<typeof employmentTypeCreateSchema>;
export type EmploymentTypeUpdateInput = z.infer<typeof employmentTypeUpdateSchema>;

// ── Locations (branches & work locations) ─────────────────────────────
export const locationTypeSchema = z.enum(['HEAD_OFFICE', 'BRANCH', 'REMOTE', 'CLIENT_SITE']);
export const locationCreateSchema = z.object({
  name,
  type: locationTypeSchema.default('BRANCH'),
  address: z
    .string()
    .trim()
    .max(200)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  city: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  country: z
    .string()
    .trim()
    .max(80)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  timezone: z
    .string()
    .trim()
    .max(64)
    .optional()
    .or(z.literal('').transform(() => undefined)),
});
export const locationUpdateSchema = locationCreateSchema.partial();
export type LocationCreateInput = z.infer<typeof locationCreateSchema>;
export type LocationUpdateInput = z.infer<typeof locationUpdateSchema>;

export const locationQuerySchema = paginationQuerySchema.extend({
  type: locationTypeSchema.optional(),
});
export type LocationQuery = z.infer<typeof locationQuerySchema>;

// ── Shifts ────────────────────────────────────────────────────────────
export const shiftCreateSchema = z.object({
  name,
  startTime: timeHHmm,
  endTime: timeHHmm,
  graceMinutes: z.coerce.number().int().min(0).max(240).default(15),
});
export const shiftUpdateSchema = shiftCreateSchema.partial();
export type ShiftCreateInput = z.infer<typeof shiftCreateSchema>;
export type ShiftUpdateInput = z.infer<typeof shiftUpdateSchema>;

// ── Holidays ──────────────────────────────────────────────────────────
export const holidayCreateSchema = z.object({
  name,
  date: dateOnlySchema,
  locationId: z
    .string()
    .nullish()
    .or(z.literal('').transform(() => null)),
  isOptional: z.boolean().default(false),
});
export const holidayUpdateSchema = holidayCreateSchema.partial();
export type HolidayCreateInput = z.infer<typeof holidayCreateSchema>;
export type HolidayUpdateInput = z.infer<typeof holidayUpdateSchema>;

export const holidayQuerySchema = paginationQuerySchema.extend({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  locationId: z.string().optional(),
});
export type HolidayQuery = z.infer<typeof holidayQuerySchema>;
