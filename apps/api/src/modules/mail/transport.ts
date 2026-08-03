import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Resend } from 'resend';
import type { Env } from '../../config/env';

/**
 * The thing that actually puts a message on the wire.
 *
 * MailService owns *what* is sent — template resolution, rendering, escaping.
 * A transport owns only *how*, so swapping Resend for SES later touches one
 * class and nothing that composes an email.
 */
export interface MailTransport {
  send(message: { to: string; subject: string; html: string }): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * The transport that was inlined in MailService until now: log it and move on.
 *
 * Still the right default rather than a hard failure — a developer with no API
 * key can exercise the whole invite flow and read the link out of the log,
 * and CI never needs a network.
 */
@Injectable()
export class LogTransport implements MailTransport {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(LogTransport.name);
  }

  async send(message: { to: string; subject: string; html: string }): Promise<void> {
    this.logger.info(message, 'Email (dev transport — message logged, not sent)');
  }
}

@Injectable()
export class ResendTransport implements MailTransport {
  private readonly resend: Resend;
  private readonly from: string;

  constructor(
    config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.resend = new Resend(config.get('RESEND_API_KEY', { infer: true }));
    this.from = config.get('MAIL_FROM', { infer: true });
    this.logger.setContext(ResendTransport.name);
  }

  async send(message: { to: string; subject: string; html: string }): Promise<void> {
    /*
     * The Resend SDK resolves with { data, error } and does NOT throw on an
     * API error, so a try/catch here would catch nothing and every failure
     * would look like a success.
     */
    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    });

    if (error) {
      /*
       * Thrown, not swallowed — the caller decides whether a failed send is
       * fatal. It is not, for an invite: the employee row is already correct
       * and HR can resend. A 403 here almost always means the sending domain
       * is unverified, or that the resend.dev sandbox is being asked to
       * deliver somewhere other than the account owner's own address.
       */
      this.logger.error({ to: message.to, error }, 'Resend rejected the message');
      throw new Error(`Email could not be sent: ${error.message}`);
    }
    this.logger.info({ to: message.to, id: data?.id }, 'Email sent');
  }
}

/**
 * Picks the transport from configuration. No key, no network: an unconfigured
 * environment logs rather than crashing on boot, which is what keeps the dev
 * and CI paths honest.
 */
export function mailTransportProvider() {
  return {
    provide: MAIL_TRANSPORT,
    inject: [ConfigService, PinoLogger],
    useFactory: (config: ConfigService<Env, true>, logger: PinoLogger): MailTransport =>
      config.get('RESEND_API_KEY', { infer: true })
        ? new ResendTransport(config, logger)
        : new LogTransport(logger),
  };
}

/** Convenience for injecting the transport into a service. */
export const InjectMailTransport = () => Inject(MAIL_TRANSPORT);
