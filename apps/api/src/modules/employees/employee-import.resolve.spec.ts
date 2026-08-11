import {
  type ManagerCandidate,
  makeLookup,
  nearestName,
  resolveManager,
  resolveRef,
} from './employee-import.resolve';

const departments = makeLookup(
  [
    { id: 'd1', name: 'Engineering' },
    { id: 'd2', name: 'People Operations' },
  ],
  'Department',
);

describe('resolveRef', () => {
  it('matches regardless of case and padding, because a spreadsheet does both', () => {
    expect(resolveRef('  engineering  ', departments, 'Department', true).id).toBe('d1');
    expect(resolveRef('ENGINEERING', departments, 'Department', true).id).toBe('d1');
  });

  it('reports a required reference that is blank', () => {
    const { problem } = resolveRef('', departments, 'Department', true);
    expect(problem?.message).toMatch(/required/);
  });

  it('says nothing about a blank optional reference', () => {
    expect(resolveRef('', departments, 'Department', false)).toEqual({});
  });

  /*
   * The one that decides whether an import is usable. Auto-creating a
   * department from a typo is how an organization ends up with "Enginering"
   * beside "Engineering" in every report forever — so the suggestion goes in
   * the message and a person decides.
   */
  it('refuses an unknown value and never invents one', () => {
    const { id, problem } = resolveRef('Enginering', departments, 'Department', true);
    expect(id).toBeUndefined();
    expect(problem?.message).toMatch(/No department called "Enginering"/);
  });

  it('suggests the near miss when there is an obvious one', () => {
    const { problem } = resolveRef('People', departments, 'Department', true);
    expect(problem?.message).toMatch(/Did you mean "people operations"\?/i);
  });
});

describe('nearestName', () => {
  it('finds a prefix and an over-long variant', () => {
    expect(nearestName('Engineer', departments)).toBe('engineering');
    expect(nearestName('Engineering Team', departments)).toBe('engineering');
  });

  it('offers nothing rather than a wild guess', () => {
    expect(nearestName('Legal', departments)).toBeUndefined();
    expect(nearestName('', departments)).toBeUndefined();
  });
});

describe('resolveManager', () => {
  const existing: ManagerCandidate[] = [
    {
      id: 'm1',
      employeeCode: 'EMP001',
      workEmail: 'meera@hrms.local',
      firstName: 'Meera',
      lastName: 'Iyer',
    },
    {
      id: 'm2',
      employeeCode: 'EMP002',
      workEmail: 'meera.i@hrms.local',
      firstName: 'Meera',
      lastName: 'Iyer',
    },
    {
      id: 'm3',
      employeeCode: 'EMP003',
      workEmail: 'raj@hrms.local',
      firstName: 'Raj',
      lastName: 'Kumar',
    },
  ];
  const none = new Set<string>();

  it('resolves by employee code, then by work email', () => {
    expect(resolveManager('EMP003', existing, none).id).toBe('m3');
    expect(resolveManager('raj@hrms.local', existing, none).id).toBe('m3');
  });

  it('resolves by an unambiguous full name', () => {
    expect(resolveManager('Raj Kumar', existing, none).id).toBe('m3');
  });

  /*
   * Two people genuinely called the same thing is not rare, and Employee has no
   * unique constraint on a name. Picking one silently would put somebody under
   * the wrong manager — a mistake nobody ever notices, because the org chart
   * looks plausible either way.
   */
  it('refuses an ambiguous name and names both candidates', () => {
    const { id, problem } = resolveManager('Meera Iyer', existing, none);
    expect(id).toBeUndefined();
    expect(problem?.message).toContain('EMP001');
    expect(problem?.message).toContain('EMP002');
  });

  /*
   * Importing an organization top-down puts every manager below the people who
   * report to them. Treating that as a missing reference would fail almost
   * every row of an entirely sensible file.
   */
  it('defers a manager who appears later in the same file', () => {
    const inFile = new Set(['newboss@hrms.local']);
    const { deferred, problem } = resolveManager('newboss@hrms.local', existing, inFile);
    expect(deferred).toBe(true);
    expect(problem).toBeUndefined();
  });

  it('reports a manager who is nowhere at all', () => {
    const { problem } = resolveManager('ghost@hrms.local', existing, none);
    expect(problem?.message).toMatch(/No employee matches/);
  });

  it('says nothing about a blank manager — somebody has to be at the top', () => {
    expect(resolveManager('', existing, none)).toEqual({});
  });
});
