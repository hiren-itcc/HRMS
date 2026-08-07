import { defaultSettings, type OrgSettings } from '@hrms/shared';
import { type LifecycleContext, LifecyclePolicyService } from './lifecycle-policy.service';

/**
 * Lifecycle policy stub for service specs.
 *
 * Only `contextFor` is faked — it is the one method that reaches the database
 * and the clock. Everything else is the real implementation, bound to an
 * instance with no dependencies because none of it touches them. So a spec
 * gets a fixed today and the genuine probation and notice arithmetic, rather
 * than a second set of rules that can drift from the ones that ship.
 */
export function lifecycleDouble(
  options: { today?: string } & Partial<OrgSettings['lifecycle']> = {},
): LifecyclePolicyService {
  const { today = '2026-08-05', ...overrides } = options;
  const ctx: LifecycleContext = {
    policy: { ...defaultSettings().lifecycle, ...overrides },
    todayKey: today,
  };

  const real = new LifecyclePolicyService(
    undefined as never,
    undefined as never,
  ) as LifecyclePolicyService;

  return {
    contextFor: async () => ctx,
    probationEnd: real.probationEnd.bind(real),
    probationOf: real.probationOf.bind(real),
    noticeFor: real.noticeFor.bind(real),
    // Structural, like settingsDouble: the private constructor fields are not
    // reachable from a literal, and nothing here reads them.
  } as unknown as LifecyclePolicyService;
}
