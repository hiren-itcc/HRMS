import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AssetCategoriesService } from './asset-categories.service';
import { AssetClearanceService } from './asset-clearance.service';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

/**
 * `AssetClearanceService` is exported because `OffboardingModule` needs it once
 * — to settle the asset item when an exit starts, so somebody who was never
 * issued anything is not blocked by a task that would sit pending forever.
 *
 * The dependency runs `Offboarding → Assets` only. Nothing here imports the
 * offboarding module; the clearance service reads those two tables through
 * Prisma directly, the way `SettlementsService` already reads `Offboarding`.
 * That is what keeps this out of `forwardRef`.
 */
@Module({
  imports: [AuditModule],
  controllers: [AssetsController],
  providers: [AssetsService, AssetCategoriesService, AssetClearanceService],
  exports: [AssetClearanceService],
})
export class AssetsModule {}
