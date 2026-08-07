import { forwardRef, Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { AuditModule } from '../audit/audit.module';
import { LifecycleModule } from '../lifecycle/lifecycle.module';
import { ResignationsModule } from '../resignations/resignations.module';
import { OffboardingsController } from './offboardings.controller';
import { OffboardingsService } from './offboardings.service';

@Module({
  imports: [AuditModule, AssetsModule, LifecycleModule, forwardRef(() => ResignationsModule)],
  controllers: [OffboardingsController],
  providers: [OffboardingsService],
  exports: [OffboardingsService],
})
export class OffboardingModule {}
