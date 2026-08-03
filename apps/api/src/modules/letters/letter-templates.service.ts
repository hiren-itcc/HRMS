import { LETTER_TEMPLATES, type LetterTemplateDefault, letterTemplateDefault } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { usedVariables } from '../mail/template-renderer';

export interface LetterTemplateView {
  key: string;
  name: string;
  description: string;
  title: string;
  bodyHtml: string;
  variables: string[];
  containsSalary: boolean;
  /** True when an edit exists; false means it is showing the shipped default. */
  isCustomised: boolean;
  /** Letters already issued from it — an edit is forward-only, so say so. */
  issuedCount: number;
  updatedAt: string | null;
}

/**
 * Per-org overrides of the shipped letter catalogue. Identical contract to
 * EmailTemplatesService: a row exists only when edited, absence falls back to
 * the built-in copy, and reset deletes the row.
 */
@Injectable()
export class LetterTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The resolved template a letter should render from, edits applied. */
  async resolve(
    orgId: string,
    key: string,
  ): Promise<{ template: LetterTemplateDefault; title: string; bodyHtml: string }> {
    const template = letterTemplateDefault(key);
    if (!template) throw new NotFoundException('Letter template not found');

    const row = await this.prisma.letterTemplate.findUnique({
      where: { organizationId_key: { organizationId: orgId, key } },
    });
    return {
      template,
      title: row?.title ?? template.title,
      bodyHtml: row?.bodyHtml ?? template.bodyHtml,
    };
  }

  async list(claims: AccessTokenClaims): Promise<LetterTemplateView[]> {
    const [stored, counts] = await Promise.all([
      this.prisma.letterTemplate.findMany({ where: { organizationId: claims.orgId } }),
      this.prisma.letter.groupBy({
        by: ['templateKey'],
        where: { organizationId: claims.orgId },
        _count: { _all: true },
      }),
    ]);
    const byKey = new Map(stored.map((t) => [t.key, t]));
    const issued = new Map(counts.map((c) => [c.templateKey, c._count._all]));

    return LETTER_TEMPLATES.map((template) => {
      const row = byKey.get(template.key);
      return {
        key: template.key,
        name: template.name,
        description: template.description,
        title: row?.title ?? template.title,
        bodyHtml: row?.bodyHtml ?? template.bodyHtml,
        variables: template.variables,
        containsSalary: template.containsSalary,
        isCustomised: row !== undefined,
        issuedCount: issued.get(template.key) ?? 0,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async update(claims: AccessTokenClaims, key: string, input: { title: string; bodyHtml: string }) {
    if (!letterTemplateDefault(key)) throw new NotFoundException('Letter template not found');

    await this.prisma.letterTemplate.upsert({
      where: { organizationId_key: { organizationId: claims.orgId, key } },
      update: input,
      create: { organizationId: claims.orgId, key, ...input },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'letter.template.update',
      'LetterTemplate',
      key,
    );
    return (await this.list(claims)).find((t) => t.key === key);
  }

  async reset(claims: AccessTokenClaims, key: string) {
    if (!letterTemplateDefault(key)) throw new NotFoundException('Letter template not found');
    await this.prisma.letterTemplate.deleteMany({
      where: { organizationId: claims.orgId, key },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'letter.template.reset',
      'LetterTemplate',
      key,
    );
    return (await this.list(claims)).find((t) => t.key === key);
  }

  /** Placeholders used but not declared — a warning in the editor, not an error. */
  unknownVariables(key: string, title: string, bodyHtml: string): string[] {
    const declared = new Set(letterTemplateDefault(key)?.variables ?? []);
    return [...new Set([...usedVariables(title), ...usedVariables(bodyHtml)])].filter(
      (name) => !declared.has(name),
    );
  }
}
