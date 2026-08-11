import { announcementCreateSchema } from '@hrms/shared';
import { describe, expect, it } from 'vitest';

/**
 * The contract between the compose dialog's default values and the resolver
 * that gates its submit button.
 *
 * `compose-dialog.tsx` starts `publishAt` and `expiresAt` as `''`, because that
 * is what an untouched `datetime-local` input holds, and the Publish-at field's
 * hint reads "Leave empty to post now". `useZodForm` resolves this schema on
 * submit — so if the schema rejects `''`, the button does nothing at all, with
 * an error attached to a date field the person deliberately left alone.
 *
 * That is exactly what happened: the end-to-end suite recorded 55 announcement
 * requests and not one POST. Nobody had noticed because the seed writes
 * announcements through Prisma and never touches this schema.
 *
 * These live here rather than in `packages/shared` only because that package
 * has no test runner.
 */
describe('the announcement form can actually be submitted', () => {
  const base = { title: 'A test announcement', body: 'Something to announce' };

  /* The dialog's own default. This is the case that was broken. */
  it('accepts the empty publish date the dialog starts with', () => {
    const result = announcementCreateSchema.safeParse({ ...base, publishAt: '' });
    expect(result.success).toBe(true);
  });

  /*
   * `undefined`, not `null` or `''` — the service reads
   * `input.publishAt ? new Date(...) : new Date()`, so absent is what makes
   * "leave empty to post now" true.
   */
  it('reads an empty publish date as "now" rather than as a value', () => {
    const result = announcementCreateSchema.parse({ ...base, publishAt: '' });
    expect(result.publishAt).toBeUndefined();
  });

  it('still accepts a real publish date', () => {
    const result = announcementCreateSchema.parse({
      ...base,
      publishAt: '2026-09-01T10:00:00+05:30',
    });
    expect(result.publishAt).toBe('2026-09-01T10:00:00+05:30');
  });

  /* The neighbouring field that always had the escape — pinned so a tidy-up
     that unifies the two cannot quietly drop it from either. */
  it('accepts an empty expiry and reads it as no expiry', () => {
    const result = announcementCreateSchema.parse({ ...base, expiresAt: '' });
    expect(result.expiresAt).toBeNull();
  });

  /* The defaults the dialog relies on rather than sending. */
  it('fills in audience, category and priority when the form omits them', () => {
    const result = announcementCreateSchema.parse(base);
    expect(result).toMatchObject({ audience: 'ALL', category: 'GENERAL', priority: 'NORMAL' });
  });

  /* And the refusals are still refusals — this widened one field, not the form. */
  it('still refuses a too-short title and an empty body', () => {
    expect(announcementCreateSchema.safeParse({ ...base, title: 'ab' }).success).toBe(false);
    expect(announcementCreateSchema.safeParse({ ...base, body: '' }).success).toBe(false);
  });

  it('still requires a department when the audience is one', () => {
    const result = announcementCreateSchema.safeParse({ ...base, audience: 'DEPARTMENT' });
    expect(result.success).toBe(false);
  });
});
