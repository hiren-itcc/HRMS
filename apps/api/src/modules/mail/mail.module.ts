import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { MailService } from './mail.service';

@Module({
  imports: [PrismaModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
