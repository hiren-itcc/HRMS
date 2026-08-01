import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness — is the process up?
   *
   * Deliberately touches nothing else. PrismaService connects lazily so the
   * API can boot without a database, and a liveness probe that failed during a
   * database outage would have the orchestrator restart a process that is
   * working perfectly well.
   */
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness — the process is running' })
  check() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /**
   * Readiness — can this instance actually serve requests?
   *
   * Everything past this endpoint needs the database, so an instance that
   * cannot reach it should leave the load-balancer pool rather than sit there
   * answering 500s. 503 says "not me, right now", which is what a readiness
   * probe is for; liveness above stays green so nothing gets restarted over a
   * database blip.
   */
  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Readiness — the database is reachable' })
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'up' };
    } catch (error) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: 'not-ready',
        database: 'down',
        // First line only, never the stack: this endpoint is unauthenticated.
        reason: error instanceof Error ? error.message.split('\n')[0] : 'unknown',
      };
    }
  }
}
