import type { AccessTokenClaims } from '@hrms/types';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { EmployeeAvatarService, type UploadedImage } from './employee-avatar.service';

const png = (over: Partial<UploadedImage> = {}): UploadedImage => ({
  originalname: 'me.png',
  mimetype: 'image/png',
  size: 40_000,
  buffer: Buffer.from('not really a png'),
  ...over,
});

function makeService(employee: Record<string, unknown> | null = { id: 'e1', avatarKey: null }) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    employee: {
      findFirst: jest.fn().mockResolvedValue(employee),
      update: jest
        .fn()
        .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
          Promise.resolve({ id: 'e1', avatarUrl: data.avatarUrl ?? null }),
        ),
    },
    auditLog: { create: jest.fn() },
  };
  const storage = {
    put: jest.fn().mockResolvedValue('org1/abcdef.png'),
    remove: jest.fn().mockResolvedValue(undefined),
    stream: jest.fn().mockResolvedValue('a-stream'),
  };
  // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
  const service = new EmployeeAvatarService(prisma, storage as any);
  return { service, prisma, storage };
}

const claims = (perms: string[], employeeId: string | undefined = 'e1'): AccessTokenClaims => ({
  sub: 'u1',
  orgId: 'org1',
  roleCode: 'EMPLOYEE',
  perms,
  employeeId,
});

const SELF = ['employee.update.own', 'directory.read'];
const HR = ['employee.update', 'directory.read'];

describe('setting a photo', () => {
  it('stores the bytes and writes the served path, not a public URL', async () => {
    const { service, storage, prisma } = makeService();
    const result = await service.set(claims(SELF), 'e1', png());

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(result.avatarUrl).toMatch(/^\/employees\/e1\/avatar\?v=[0-9a-f]{8}$/);
    expect(prisma.employee.update.mock.calls[0][0].data.avatarKey).toBe('org1/abcdef.png');
  });

  /*
   * The key's extension becomes the Content-Type the read route declares, so
   * letting the upload name the file would let it choose that header.
   */
  it('names the stored file from the validated mimetype, not from the upload', async () => {
    const { service, storage } = makeService();
    await service.set(claims(SELF), 'e1', png({ originalname: '../../evil.html' }));

    expect(storage.put.mock.calls[0][1]).toBe('avatar.png');
  });

  it('refuses anything that is not a PNG, JPEG or WebP', async () => {
    const { service, storage } = makeService();
    await expect(
      service.set(claims(SELF), 'e1', png({ mimetype: 'application/pdf' })),
    ).rejects.toThrow(BadRequestException);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('refuses an image over the cap', async () => {
    const { service } = makeService();
    await expect(service.set(claims(SELF), 'e1', png({ size: 3 * 1024 * 1024 }))).rejects.toThrow(
      /too large/,
    );
  });

  it('refuses an empty file', async () => {
    const { service } = makeService();
    await expect(service.set(claims(SELF), 'e1', png({ size: 0 }))).rejects.toThrow(/empty/);
  });

  /* Replacing must not leave the old bytes behind paying for storage forever. */
  it('discards the previous image when one is replaced', async () => {
    const { service, storage } = makeService({ id: 'e1', avatarKey: 'org1/old.png' });
    await service.set(claims(SELF), 'e1', png());

    expect(storage.remove).toHaveBeenCalledWith('org1/old.png');
  });

  /*
   * Order matters. Deleting first and then failing to write the new key would
   * leave the row pointing at bytes that no longer exist; an orphaned object
   * costs a few kilobytes.
   */
  it('writes the new row before discarding the old image', async () => {
    const { service, prisma, storage } = makeService({ id: 'e1', avatarKey: 'org1/old.png' });
    const order: string[] = [];
    prisma.employee.update.mockImplementation(() => {
      order.push('update');
      return Promise.resolve({ id: 'e1', avatarUrl: '/employees/e1/avatar?v=1' });
    });
    storage.remove.mockImplementation(() => {
      order.push('remove');
      return Promise.resolve();
    });

    await service.set(claims(SELF), 'e1', png());
    expect(order).toEqual(['update', 'remove']);
  });

  /* A photo already gone from the bucket must not stop a new one being set. */
  it('survives a storage removal that fails', async () => {
    const { service, storage } = makeService({ id: 'e1', avatarKey: 'org1/gone.png' });
    storage.remove.mockRejectedValue(new Error('404 from the bucket'));

    await expect(service.set(claims(SELF), 'e1', png())).resolves.toMatchObject({ id: 'e1' });
  });
});

describe('who may change whose', () => {
  it('lets somebody set their own with employee.update.own', async () => {
    const { service } = makeService();
    await expect(service.set(claims(SELF), 'e1', png())).resolves.toBeDefined();
  });

  /*
   * The check the route cannot make: the guard sees a permission, not whose
   * record the id belongs to. Without this, self-service would be a way to put
   * a photo on a colleague.
   */
  it("refuses a colleague's record to somebody holding only the self permission", async () => {
    const { service, storage } = makeService();
    await expect(service.set(claims(SELF, 'e1'), 'someone-else', png())).rejects.toThrow(
      ForbiddenException,
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('lets HR set anybody’s with employee.update', async () => {
    const { service } = makeService();
    await expect(service.set(claims(HR, 'hr1'), 'e1', png())).resolves.toBeDefined();
  });

  it('refuses somebody holding neither', async () => {
    const { service } = makeService();
    await expect(service.set(claims(['directory.read']), 'e1', png())).rejects.toThrow(
      ForbiddenException,
    );
  });
});

describe('taking one down', () => {
  it('clears both columns and removes the object', async () => {
    const { service, prisma, storage } = makeService({ id: 'e1', avatarKey: 'org1/old.png' });
    await service.remove(claims(SELF), 'e1');

    expect(prisma.employee.update.mock.calls[0][0].data).toEqual({
      avatarKey: null,
      avatarUrl: null,
    });
    expect(storage.remove).toHaveBeenCalledWith('org1/old.png');
  });

  /* Idempotent: removing a photo nobody set is not an error. */
  it('does nothing when there is no photo', async () => {
    const { service, prisma } = makeService({ id: 'e1', avatarKey: null });
    await expect(service.remove(claims(SELF), 'e1')).resolves.toEqual({
      id: 'e1',
      avatarUrl: null,
    });
    expect(prisma.employee.update).not.toHaveBeenCalled();
  });
});

describe('reading one', () => {
  /*
   * Wide on purpose. The directory and the org chart already show every
   * colleague's face to everybody, so gating on `employee.read` would leave
   * photo-shaped holes in both for ordinary staff.
   */
  it('is open to anybody who can see the directory', async () => {
    const { service } = makeService({ id: 'e1', avatarKey: 'org1/x.webp' });
    await expect(service.open(claims(['directory.read']), 'e1')).resolves.toMatchObject({
      mimeType: 'image/webp',
    });
  });

  it('refuses somebody without directory.read', async () => {
    const { service } = makeService({ id: 'e1', avatarKey: 'org1/x.webp' });
    await expect(service.open(claims([]), 'e1')).rejects.toThrow(ForbiddenException);
  });

  /* 404 rather than a placeholder: the browser falls back to initials. */
  it('is a 404 when nobody has set one', async () => {
    const { service } = makeService({ id: 'e1', avatarKey: null });
    await expect(service.open(claims(['directory.read']), 'e1')).rejects.toThrow(NotFoundException);
  });

  it('declares the type from the stored key', async () => {
    const { service } = makeService({ id: 'e1', avatarKey: 'org1/x.jpg' });
    await expect(service.open(claims(['directory.read']), 'e1')).resolves.toMatchObject({
      mimeType: 'image/jpeg',
    });
  });
});

describe('an account with no employee record', () => {
  it('cannot set a photo on nobody', async () => {
    const { service } = makeService();
    await expect(
      service.setForSelf({ ...claims(SELF), employeeId: undefined }, png()),
    ).rejects.toThrow(NotFoundException);
  });
});
