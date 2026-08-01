import { feedOrder, isLive, isVisibleTo, targetsViewer } from './announcements.util';

const NOW = new Date('2026-08-05T10:00:00.000Z');
const live = { publishAt: new Date('2026-08-01T00:00:00.000Z'), expiresAt: null };

describe('targetsViewer', () => {
  const viewer = { departmentId: 'd1', locationId: 'l1' };

  it('shows ALL posts to everyone, even with no department or location', () => {
    const spec = { audience: 'ALL' as const, departmentId: null, locationId: null };
    expect(targetsViewer(spec, viewer)).toBe(true);
    expect(targetsViewer(spec, {})).toBe(true);
  });

  it('matches department posts only for that department', () => {
    const spec = { audience: 'DEPARTMENT' as const, departmentId: 'd1', locationId: null };
    expect(targetsViewer(spec, viewer)).toBe(true);
    expect(targetsViewer(spec, { departmentId: 'd2' })).toBe(false);
    expect(targetsViewer(spec, {})).toBe(false);
  });

  it('matches location posts only for that location', () => {
    const spec = { audience: 'LOCATION' as const, departmentId: null, locationId: 'l1' };
    expect(targetsViewer(spec, viewer)).toBe(true);
    expect(targetsViewer(spec, { locationId: 'l2' })).toBe(false);
  });

  it('never leaks a department post that forgot its target', () => {
    // Without this guard a null==null match would make it org-wide
    const spec = { audience: 'DEPARTMENT' as const, departmentId: null, locationId: null };
    expect(targetsViewer(spec, {})).toBe(false);
    expect(targetsViewer(spec, { departmentId: null })).toBe(false);
  });
});

describe('isLive', () => {
  it('hides posts scheduled for the future', () => {
    expect(isLive({ publishAt: new Date('2026-08-06T00:00:00.000Z'), expiresAt: null }, NOW)).toBe(
      false,
    );
  });

  it('shows posts already published with no expiry', () => {
    expect(isLive(live, NOW)).toBe(true);
  });

  it('hides posts past their expiry', () => {
    expect(
      isLive({ publishAt: live.publishAt, expiresAt: new Date('2026-08-04T00:00:00.000Z') }, NOW),
    ).toBe(false);
  });

  it('shows posts whose expiry is still ahead', () => {
    expect(
      isLive({ publishAt: live.publishAt, expiresAt: new Date('2026-08-09T00:00:00.000Z') }, NOW),
    ).toBe(true);
  });
});

describe('isVisibleTo', () => {
  const scheduled = {
    audience: 'DEPARTMENT' as const,
    departmentId: 'd1',
    locationId: null,
    publishAt: new Date('2026-08-09T00:00:00.000Z'),
    expiresAt: null,
  };

  it('hides scheduled, off-target posts from ordinary readers', () => {
    expect(isVisibleTo(scheduled, { departmentId: 'd2' }, NOW, false)).toBe(false);
  });

  it('shows drafts and off-target posts to managers', () => {
    expect(isVisibleTo(scheduled, { departmentId: 'd2' }, NOW, true)).toBe(true);
  });

  it('requires both live and targeted for a reader', () => {
    const targetedButScheduled = { ...scheduled, departmentId: 'd1' };
    expect(isVisibleTo(targetedButScheduled, { departmentId: 'd1' }, NOW, false)).toBe(false);

    const liveAndTargeted = { ...scheduled, publishAt: live.publishAt };
    expect(isVisibleTo(liveAndTargeted, { departmentId: 'd1' }, NOW, false)).toBe(true);
  });
});

describe('feedOrder', () => {
  it('puts pinned posts first, then newest', () => {
    const posts = [
      { id: 'old', isPinned: false, publishAt: new Date('2026-08-01') },
      { id: 'pinned-old', isPinned: true, publishAt: new Date('2026-07-01') },
      { id: 'new', isPinned: false, publishAt: new Date('2026-08-04') },
    ];
    expect([...posts].sort(feedOrder).map((p) => p.id)).toEqual(['pinned-old', 'new', 'old']);
  });
});
