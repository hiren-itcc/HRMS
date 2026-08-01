import { Module } from '@nestjs/common';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

/** Roles and permission grants (docs/04-rbac.md — RBAC is data, not code). */
@Module({
  controllers: [RbacController],
  providers: [RbacService],
})
export class RbacModule {}
