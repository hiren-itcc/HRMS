import { EMAIL_TEMPLATES, emailTemplateDefault } from '@hrms/shared';
import type { AccessTokenClaims } from '@hrms/types';
import { Injectable, NotFoundException } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';

export interface EmailTemplateView {
  key: string;
  name: string;
  description: string;
  subject: string;
  bodyHtml: string;
  variables: string[];
  isActive: boolean;
  /** False when nothing sends this yet — the UI says so rather than implying it works. */
  hasSender: boolean;
  /** True when an edit exists; false means it is showing the shipped default. */
  isCustomised: boolean;
  updatedAt: string | null;
}

/**
 * Which templates something actually sends. Drives the "nothing sends this
 * yet" label, so it has to be kept honest when a sender is built — the leave
 * pair sat here unwired long enough for the feature audit to record it.
 */
const WIRED_KEYS = new Set([
  'password_reset', // auth.service.ts
  'employee_invite', // invite.service.ts
  'leave_approved', // leave-requests.service.ts
  'leave_rejected', // leave-requests.service.ts
  'notification_generic', // notifications.service.ts — every other module
]);

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The catalog merged with any stored edits, so a template that has never
   * been touched still appears with its shipped copy.
   */
  async list(claims: AccessTokenClaims): Promise<EmailTemplateView[]> {
    const stored = await this.prisma.emailTemplate.findMany({
      where: { organizationId: claims.orgId },
    });
    const byKey = new Map(stored.map((t) => [t.key, t]));

    return EMAIL_TEMPLATES.map((template) => {
      const row = byKey.get(template.key);
      return {
        key: template.key,
        name: template.name,
        description: template.description,
        subject: row?.subject ?? template.subject,
        bodyHtml: row?.bodyHtml ?? template.bodyHtml,
        variables: template.variables,
        isActive: row?.isActive ?? template.active,
        hasSender: WIRED_KEYS.has(template.key),
        isCustomised: row !== undefined,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async update(
    claims: AccessTokenClaims,
    key: string,
    input: { subject: string; bodyHtml: string; isActive: boolean },
  ) {
    const template = emailTemplateDefault(key);
    if (!template) throw new NotFoundException('Email template not found');

    await this.prisma.emailTemplate.upsert({
      where: { organizationId_key: { organizationId: claims.orgId, key } },
      update: input,
      create: { organizationId: claims.orgId, key, ...input },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'settings.email_template.update',
      'EmailTemplate',
      key,
    );

    const list = await this.list(claims);
    return list.find((t) => t.key === key);
  }

  /** Drops the stored edit so the template falls back to the shipped copy. */
  async reset(claims: AccessTokenClaims, key: string) {
    if (!emailTemplateDefault(key)) throw new NotFoundException('Email template not found');
    await this.prisma.emailTemplate.deleteMany({
      where: { organizationId: claims.orgId, key },
    });
    await auditMutation(
      this.prisma,
      { orgId: claims.orgId, userId: claims.sub },
      'settings.email_template.reset',
      'EmailTemplate',
      key,
    );
    const list = await this.list(claims);
    return list.find((t) => t.key === key);
  }
}
