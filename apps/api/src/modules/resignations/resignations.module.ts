import { forwardRef, Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { OffboardingModule } from '../offboarding/offboarding.module';
import { ResignationsController } from './resignations.controller';
import { ResignationsService } from './resignations.service';

/**
 * The `forwardRef` pair with OffboardingModule is deliberate and is the only
 * one in the codebase: approving a resignation opens an offboarding, and
 * completing an offboarding closes the resignation. Both directions are real
 * domain facts, and breaking the cycle would mean a coordinator module that
 * exists only to hold two method calls.
 */
@Module({
  imports: [AuditModule, LifecycleModule, forwardRef(() => OffboardingModule)],
  controllers: [ResignationsController],
  providers: [ResignationsService],
  exports: [ResignationsService],
})
export class ResignationsModule {}
