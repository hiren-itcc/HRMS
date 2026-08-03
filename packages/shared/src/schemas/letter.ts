import { z } from 'zod';
import { paginationQuerySchema } from './common';

/**
 * Issuing takes a subject and a template key and nothing else. The body is
 * never client-supplied: the server renders from the resolved template and its
 * own lookup, which is what makes the HTML-escaping guarantee hold for a
 * document that is then frozen forever.
 */
export const letterIssueSchema = z.object({
  employeeId: z.string().min(1),
  templateKey: z.string().min(1),
});
export type LetterIssueInput = z.infer<typeof letterIssueSchema>;

export const letterPreviewQuerySchema = letterIssueSchema;
export type LetterPreviewQuery = z.infer<typeof letterPreviewQuerySchema>;

/** A withdrawal needs to say why — the letter itself cannot be unmade. */
export const letterVoidSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required').max(300),
});
export type LetterVoidInput = z.infer<typeof letterVoidSchema>;

export const letterTemplateUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(200),
  bodyHtml: z.string().trim().min(1, 'Body is required').max(20_000),
});
export type LetterTemplateUpdateInput = z.infer<typeof letterTemplateUpdateSchema>;

export const letterQuerySchema = paginationQuerySchema.extend({
  templateKey: z.string().optional(),
  status: z.enum(['ISSUED', 'VOID']).optional(),
});
export type LetterQuery = z.infer<typeof letterQuerySchema>;
