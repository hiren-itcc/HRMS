import type { OrgSettings } from '@hrms/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { dateKeyInTz } from '../attendance/attendance.util';
import { SettingsService } from '../settings/settings.service';
import {
  earliestLastWorkingDate,
  effectiveNoticeDays,
  type LifecycleFields,
  type ProbationView,
  probationEndFor,
  probationStateOf,
} from './lifecycle.rules';

/**
 * What every lifecycle decision needs and nothing else: the organization's
 * policy, and the organization's idea of what day it is.
 *
 * Today is resolved once, at the top of a request, rather than each time a
 * rule is called. A resignation filed at 23:59 must not compute its notice
 * from one date and its earliest last working day from the next.
 */
export interface LifecycleContext {
  policy: OrgSettings['lifecycle'];
  /** YYYY-MM-DD in the organization's timezone. */
  todayKey: string;
}

/**
 * The bridge between the pure rules and the two things they cannot reach:
 * organization settings and the clock.
 *
 * Deliberately has no dependency on employees, resignations or offboarding —
 * all three depend on *it*, and a dependency the other way would close a cycle
 * the moment the daily tick needed any of them.
 */
@Injectable()
export class LifecyclePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async contextFor(orgId: string): Promise<LifecycleContext> {
    const [settings, org] = await Promise.all([
      this.settings.get(orgId),
      this.prisma.organization.findUnique({ where: { id: orgId }, select: { timezone: true } }),
    ]);
    // UTC rather than the server's zone: a fallback that follows wherever the
    // process happens to run would put an organization's "today" on a
    // different day depending on the region it was deployed to.
    return {
      policy: settings.lifecycle,
      todayKey: dateKeyInTz(new Date(), org?.timezone ?? 'UTC'),
    };
  }

  /** Where a hire's probation lands, given whatever override they carry. */
  probationEnd(joinDateKey: string, months: number | null, ctx: LifecycleContext): Date | null {
    const end = probationEndFor(joinDateKey, months, ctx.policy);
    return end ? new Date(`${end}T00:00:00.000Z`) : null;
  }

  probationOf(employee: LifecycleFields, ctx: LifecycleContext): ProbationView {
    return probationStateOf(employee, ctx.todayKey);
  }

  /** The notice this person owes, and the soonest day it lets them leave. */
  noticeFor(employee: Pick<LifecycleFields, 'noticePeriodDays'>, ctx: LifecycleContext) {
    const noticeDays = effectiveNoticeDays(employee, ctx.policy);
    return {
      noticeDays,
      earliestLastWorkingDate: earliestLastWorkingDate(ctx.todayKey, noticeDays),
    };
  }
}
