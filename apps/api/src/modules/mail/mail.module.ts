import { Module } from '@nestjs/common';
import { PrismaModule } from '../../database/prisma.module';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, mailTransportProvider } from './transport';

@Module({
  imports: [PrismaModule],
  providers: [MailService, mailTransportProvider()],
  exports: [MailService, MAIL_TRANSPORT],
})
export class MailModule {}
