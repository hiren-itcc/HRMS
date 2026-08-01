import { HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import type { PrismaService } from '../../database/prisma.service';
import { HealthController } from './health.controller';

/**
 * The point of splitting liveness from readiness is that they disagree during
 * a database outage. These assert that they do — a readiness probe that
 * cannot fail is decoration.
 */
function setup(queryRaw: () => Promise<unknown>) {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  const res = { status: jest.fn() } as unknown as Response;
  return { controller: new HealthController(prisma), res };
}

describe('HealthController', () => {
  it('reports live without touching the database', () => {
    const { controller } = setup(() => Promise.reject(new Error('should not be called')));
    expect(controller.check().status).toBe('ok');
  });

  it('reports ready when the database answers', async () => {
    const { controller, res } = setup(() => Promise.resolve([{ '?column?': 1 }]));
    await expect(controller.ready(res)).resolves.toMatchObject({
      status: 'ready',
      database: 'up',
    });
    expect(res.status).not.toHaveBeenCalled();
  });

  it('answers 503 when the database is unreachable', async () => {
    const { controller, res } = setup(() =>
      Promise.reject(new Error("Can't reach database server at localhost:5432\n  stack line")),
    );
    const body = await controller.ready(res);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(body).toMatchObject({ status: 'not-ready', database: 'down' });
  });

  it('leaks only the first line of the error — the endpoint is unauthenticated', async () => {
    const { controller, res } = setup(() =>
      Promise.reject(new Error('Connection refused\n    at Socket.emit (node:events)')),
    );
    const body = (await controller.ready(res)) as { reason: string };
    expect(body.reason).toBe('Connection refused');
    expect(body.reason).not.toContain('at Socket');
  });
});
