import type { CompanyUpdateInput } from '@hrms/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import type { OrgCtx } from '../org-context';
import { auditOrgMutation } from './audit.helper';

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  get(orgId: string) {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { id: true, name: true, slug: true, timezone: true, logoUrl: true, createdAt: true },
    });
  }

  async update(ctx: OrgCtx, input: CompanyUpdateInput) {
    const org = await this.prisma.organization.update({
      where: { id: ctx.orgId },
      data: input,
      select: { id: true, name: true, slug: true, timezone: true, logoUrl: true, createdAt: true },
    });
    await auditOrgMutation(this.prisma, ctx, 'org.company.update', 'Organization', ctx.orgId);
    return org;
  }
}
