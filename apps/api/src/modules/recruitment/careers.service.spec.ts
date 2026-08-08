import { CareersService } from './careers.service';

type Mock = jest.Mock;

/**
 * The public careers page.
 *
 * Most of what is asserted here is about what does **not** come out. This is
 * the only unauthenticated surface in the product, so the interesting failures
 * are all disclosure: a salary band on the open internet, a closed role that
 * confirms it exists, an email address that can be tested for.
 */

const OPEN_ROW = {
  id: 'jo1',
  slug: 'senior-backend-engineer',
  title: 'Senior Backend Engineer',
  description: 'Own the payments service.',
  openedOn: new Date('2026-07-01T00:00:00Z'),
  department: { name: 'Engineering' },
  location: { name: 'Ahmedabad' },
  employmentType: { name: 'Full time' },
  // Everything below is internal and must never reach a response.
  minMonthlyCtc: 180000,
  maxMonthlyCtc: 260000,
  hiringManagerId: 'emp-secret-manager',
  headcount: 3,
  createdById: 'user-secret',
  status: 'OPEN',
};

function makeService(opening: unknown = OPEN_ROW) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    organization: { findMany: jest.fn().mockResolvedValue([{ id: 'org1' }]) },
    jobOpening: {
      findMany: jest.fn().mockResolvedValue([OPEN_ROW]),
      findFirst: jest.fn().mockResolvedValue(opening),
    },
    candidate: {
      upsert: jest.fn().mockResolvedValue({ id: 'c1', firstName: 'Ada', lastName: 'L' }),
    },
    application: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'a1' }),
      update: jest.fn().mockResolvedValue({ id: 'a1' }),
    },
    document: { create: jest.fn().mockResolvedValue({ id: 'doc1' }) },
  };
  const storage = { put: jest.fn().mockResolvedValue('org1/careers/uuid.pdf') };
  const notifications = { notifyPermission: jest.fn(), notify: jest.fn() };
  const logger = { setContext: jest.fn(), warn: jest.fn() };
  const service = new CareersService(
    prisma,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    storage as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    notifications as any,
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    logger as any,
  );
  return { service, prisma, storage, notifications };
}

const APPLICANT = { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };
const PDF = {
  originalname: 'ada-cv.pdf',
  mimetype: 'application/pdf',
  size: 120_000,
  buffer: Buffer.from('%PDF-1.7'),
};

/*
 * Serialised and searched, rather than checked key by key. A key-by-key
 * assertion passes happily when somebody adds a field; this is the shape of
 * failure that would matter, and it is invisible in a diff.
 */
describe('what the public sees', () => {
  it('publishes no salary band, no hiring manager and no headcount', async () => {
    const { service } = makeService();

    const listed = JSON.stringify(await service.list());
    const one = JSON.stringify(await service.get('senior-backend-engineer'));

    for (const body of [listed, one]) {
      expect(body).not.toContain('180000');
      expect(body).not.toContain('260000');
      expect(body).not.toContain('emp-secret-manager');
      expect(body).not.toContain('user-secret');
      expect(body).not.toContain('headcount');
      expect(body).not.toContain('jo1');
    }
  });

  it('publishes the things a job advert is actually for', async () => {
    const { service } = makeService();
    await expect(service.get('senior-backend-engineer')).resolves.toEqual({
      slug: 'senior-backend-engineer',
      title: 'Senior Backend Engineer',
      department: 'Engineering',
      location: 'Ahmedabad',
      employmentType: 'Full time',
      description: 'Own the payments service.',
      openedOn: '2026-07-01',
    });
  });

  /* OPEN is the decision to hire; a slug is the decision to say so publicly. */
  it('lists only open roles that have been given a public link', async () => {
    const { service, prisma } = makeService();
    await service.list();
    expect((prisma.jobOpening.findMany as Mock).mock.calls[0][0].where).toMatchObject({
      status: 'OPEN',
      slug: { not: null },
    });
  });

  /* A closed role and a role that never existed must answer identically. */
  it('does not distinguish a closed role from one that never existed', async () => {
    const { service } = makeService(null);
    await expect(service.get('anything-at-all')).rejects.toThrow(/no longer open/i);
  });
});

describe('applying', () => {
  it('records the candidate and the application', async () => {
    const { service, prisma, notifications } = makeService();

    await expect(service.apply('senior-backend-engineer', APPLICANT)).resolves.toEqual({
      received: true,
    });
    expect(prisma.candidate.upsert).toHaveBeenCalled();
    expect(prisma.application.create).toHaveBeenCalled();
    expect(notifications.notifyPermission).toHaveBeenCalledWith(
      'org1',
      'recruitment.read',
      expect.objectContaining({ type: 'recruitment.applied' }),
    );
  });

  /*
   * "You have already applied" is a way to test whether an email address is in
   * the database, and this is the one endpoint anybody at all can ask.
   */
  it('reports the same success to somebody who already applied', async () => {
    const { service, prisma } = makeService();
    (prisma.application.findUnique as Mock).mockResolvedValue({ id: 'a1' });

    await expect(service.apply('senior-backend-engineer', APPLICANT)).resolves.toEqual({
      received: true,
    });
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  /* Re-applying must not drag somebody at INTERVIEW back to APPLIED. */
  it('does not reset the stage of an application already in flight', async () => {
    const { service, prisma } = makeService();
    (prisma.application.findUnique as Mock).mockResolvedValue({ id: 'a1' });

    await service.apply('senior-backend-engineer', APPLICANT, PDF);

    const update = (prisma.application.update as Mock).mock.calls[0][0];
    expect(update.data).toEqual({ resumeDocumentId: 'doc1' });
    expect(update.data).not.toHaveProperty('stage');
  });

  /*
   * Attribution belongs to the hiring side. A stranger writing their own
   * `source` or `referrerId` would be inventing a referral — and referrals
   * often carry a bonus.
   */
  it('will not let an applicant write their own source or referrer', async () => {
    const { service, prisma } = makeService();
    await service.apply('senior-backend-engineer', {
      ...APPLICANT,
      // Not in the schema; this is what a hand-rolled POST would carry.
      ...({ source: 'Employee referral', referrerId: 'emp-9' } as object),
    });

    const created = (prisma.candidate.upsert as Mock).mock.calls[0][0];
    expect(created.create.source).toBe('Careers page');
    expect(created.create.referrerId).toBeUndefined();
    expect(created.update).not.toHaveProperty('source');
    expect(created.update).not.toHaveProperty('referrerId');
  });
});

describe('the CV, which is an anonymous file in a private bucket', () => {
  it('stores it under a careers prefix, attributed to nobody', async () => {
    const { service, storage, prisma } = makeService();

    await service.apply('senior-backend-engineer', APPLICANT, PDF);

    expect(storage.put).toHaveBeenCalledWith(
      'org1/careers',
      'ada-cv.pdf',
      expect.any(Buffer),
      'application/pdf',
    );
    // No employee, and no user — because there is neither.
    const doc = (prisma.document.create as Mock).mock.calls[0][0].data;
    expect(doc.uploadedById).toBeNull();
    expect(doc.employeeId).toBeUndefined();
  });

  /*
   * Checked on the declared type *and* the extension. A browser sends whatever
   * content type it likes and an extension is chosen by whoever uploads;
   * neither alone is a check, and agreeing is the cheapest thing that is.
   */
  it('refuses an executable wearing a PDF content type', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.apply('senior-backend-engineer', APPLICANT, {
        originalname: 'cv.exe',
        mimetype: 'application/pdf',
        size: 1000,
        buffer: Buffer.from('MZ'),
      }),
    ).rejects.toThrow(/PDF or Word/i);
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it('refuses a PDF extension with an executable content type', async () => {
    const { service } = makeService();

    await expect(
      service.apply('senior-backend-engineer', APPLICANT, {
        originalname: 'cv.pdf',
        mimetype: 'application/x-msdownload',
        size: 1000,
        buffer: Buffer.from('MZ'),
      }),
    ).rejects.toThrow(/PDF or Word/i);
  });

  it('refuses one that is too large', async () => {
    const { service } = makeService();

    await expect(
      service.apply('senior-backend-engineer', APPLICANT, { ...PDF, size: 9_000_000 }),
    ).rejects.toThrow(/too large/i);
  });

  it('accepts an application with no CV at all', async () => {
    const { service, storage } = makeService();
    await expect(service.apply('senior-backend-engineer', APPLICANT)).resolves.toEqual({
      received: true,
    });
    expect(storage.put).not.toHaveBeenCalled();
  });
});

describe('slugs', () => {
  it('makes one from the title', async () => {
    const { service, prisma } = makeService();
    (prisma.jobOpening.findFirst as Mock).mockResolvedValue(null);
    await expect(service.ensureSlug('org1', 'jo1', 'Senior Backend Engineer')).resolves.toBe(
      'senior-backend-engineer',
    );
  });

  it('counts up rather than colliding', async () => {
    const { service, prisma } = makeService();
    (prisma.jobOpening.findFirst as Mock)
      .mockResolvedValueOnce({ id: 'other' })
      .mockResolvedValueOnce(null);
    await expect(service.ensureSlug('org1', 'jo1', 'Designer')).resolves.toBe('designer-2');
  });

  /* A title of nothing but punctuation still has to produce a usable URL. */
  it('falls back when a title slugifies to nothing', async () => {
    const { service, prisma } = makeService();
    (prisma.jobOpening.findFirst as Mock).mockResolvedValue(null);
    await expect(service.ensureSlug('org1', 'jo1', '!!!')).resolves.toBe('role');
  });
});
