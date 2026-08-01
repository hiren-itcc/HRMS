import type { OrgSettings, OrgSettingsPatch } from '@hrms/shared';
import { Injectable } from '@nestjs/common';
import { auditMutation } from '../../common/utils/audit';
import { PrismaService } from '../../database/prisma.service';
import { mergeSettings } from './settings.registry';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fully-defaulted settings for an organization. Called on the read path of
   * attendance and leave, so it stays a single indexed lookup by primary key.
   */
  async get(orgId: string): Promise<OrgSettings> {
    const rows = await this.prisma.setting.findMany({
      where: { organizationId: orgId },
      select: { key: true, value: true },
    });
    return mergeSettings(rows);
  }

  /**
   * Upserts only the groups present in the patch — one row per group, so
   * saving Localization can never clobber a concurrent Working week edit.
   */
  async patch(
    ctx: { orgId: string; userId: string },
    patch: OrgSettingsPatch,
  ): Promise<OrgSettings> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);

    await this.prisma.$transaction(
      entries.map(([key, value]) =>
        this.prisma.setting.upsert({
          where: { organizationId_key: { organizationId: ctx.orgId, key } },
          update: { value: value as object },
          create: { organizationId: ctx.orgId, key, value: value as object },
        }),
      ),
    );

    for (const [key] of entries) {
      await auditMutation(this.prisma, ctx, 'settings.update', 'Setting', key);
    }
    return this.get(ctx.orgId);
  }
}
