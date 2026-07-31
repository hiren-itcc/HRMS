import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

/**
 * Mail port (ADR A5) — provider is config, callers depend on this interface.
 * Until an SMTP provider is wired, the dev adapter logs the message so the
 * reset flow is fully exercisable locally.
 */
@Injectable()
export class MailService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(MailService.name);
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<void> {
    // SMTP adapter replaces this body; the signature is the contract.
    this.logger.info({ to, resetUrl }, 'Password reset email (dev transport — link logged only)');
  }
}
