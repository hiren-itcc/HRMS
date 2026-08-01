import { defaultSettings } from '@hrms/shared';
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
