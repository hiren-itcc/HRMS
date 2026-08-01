import { defaultSettings, orgSettingsPatchSchema } from '@hrms/shared';
import { mergeSettings } from './settings.registry';

describe('mergeSettings', () => {
  it('returns the full defaults for a fresh organization', () => {
    expect(mergeSettings([])).toEqual(defaultSettings());
  });

  it('overlays a stored group', () => {
    const merged = mergeSettings([{ key: 'workingWeek', value: { weekOffDays: [0] } }]);
    expect(merged.workingWeek.weekOffDays).toEqual([0]);
  });

  it('leaves the other groups at their defaults', () => {
    const merged = mergeSettings([{ key: 'leave', value: { yearStartMonth: 4 } }]);
    expect(merged.leave.yearStartMonth).toBe(4);
    expect(merged.leave.allowNegativeBalance).toBe(false);
    expect(merged.workingWeek).toEqual(defaultSettings().workingWeek);
  });

  it('keeps weekStartsOn at its default when only weekOffDays is stored', () => {
    const merged = mergeSettings([{ key: 'workingWeek', value: { weekOffDays: [5, 6] } }]);
    expect(merged.workingWeek.weekOffDays).toEqual([5, 6]);
    expect(merged.workingWeek.weekStartsOn).toBe(1);
  });

  it('fills missing keys within a stored group from the defaults', () => {
    const merged = mergeSettings([{ key: 'modules', value: { reports: false } }]);
    expect(merged.modules.reports).toBe(false);
    expect(merged.modules.attendance).toBe(true);
  });

  it('falls back to the default when a stored group no longer parses', () => {
    const merged = mergeSettings([{ key: 'workingWeek', value: { weekOffDays: 'saturday' } }]);
    expect(merged.workingWeek.weekOffDays).toEqual([0, 6]);
  });

  it('ignores rows for unknown keys', () => {
    expect(mergeSettings([{ key: 'somethingElse', value: { a: 1 } }])).toEqual(defaultSettings());
  });

  it('normalises a stored week-off list (dedupes and sorts)', () => {
    const merged = mergeSettings([{ key: 'workingWeek', value: { weekOffDays: [6, 0, 6] } }]);
    expect(merged.workingWeek.weekOffDays).toEqual([0, 6]);
  });
});

/*
 * The patch schema must never materialise a key the caller did not send:
 * settings are stored per group, so a widened patch overwrites the whole row
 * and silently resets its siblings.
 */
describe('orgSettingsPatchSchema', () => {
  it('keeps a flat patch to the keys that were sent', () => {
    expect(orgSettingsPatchSchema.parse({ leave: { yearStartMonth: 4 } })).toEqual({
      leave: { yearStartMonth: 4 },
    });
  });

  it('keeps a nested patch to the keys that were sent', () => {
    // payroll.pf carries its own defaults one level down. Before asPatch
    // recursed, this returned every PF key and a rate change reset the ceiling.
    expect(orgSettingsPatchSchema.parse({ payroll: { pf: { employeeRate: 10 } } })).toEqual({
      payroll: { pf: { employeeRate: 10 } },
    });
  });

  it('still materialises full defaults when reading, not patching', () => {
    const settings = defaultSettings();
    expect(settings.payroll.pf.wageCeiling).toBe(15000);
    expect(settings.payroll.esi.wageThreshold).toBe(21000);
    expect(settings.payroll.professionalTax.slabs.length).toBeGreaterThan(0);
  });

  it('rejects an empty patch', () => {
    expect(orgSettingsPatchSchema.safeParse({}).success).toBe(false);
  });
});
