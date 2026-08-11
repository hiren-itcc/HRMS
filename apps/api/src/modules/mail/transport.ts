import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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
 * Every message as a JSON file in a directory. Off unless `MAIL_OUTBOX_DIR` is
 * set, which is why it can sit in the same switch as the real transports.
 *
 * This exists so an end-to-end test can *assert* on an invite link rather than
 * scraping one out of a pino log — the difference between a test that breaks
 * when the log format changes and one that breaks when the invite does. It is
 * also the nicest way to read your own outbox in local development.
 *
 * Writes are best-effort: a test harness that cannot write its own outbox
 * should fail on the missing assertion, not by taking down the request that was
 * trying to send.
 */
@Injectable()
export class FileTransport implements MailTransport {
  constructor(
    private readonly dir: string,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(FileTransport.name);
  }

  async send(message: { to: string; subject: string; html: string }): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      // Counter, not a timestamp: two messages inside one millisecond are
      // exactly what an invite-then-reset flow produces, and a clash would
      // silently drop the one a test is looking for.
      const name = `${String(FileTransport.written++).padStart(4, '0')}.json`;
      await writeFile(
        join(this.dir, name),
        JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2),
        'utf8',
      );
    } catch (err) {
      this.logger.warn({ err, to: message.to }, 'Could not write to the mail outbox');
    }
  }

  private static written = 0;
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
    useFactory: (config: ConfigService<Env, true>, logger: PinoLogger): MailTransport => {
      const from = config.get('MAIL_FROM', { infer: true });

      /*
       * Checked before the API key, so a harness that sets both gets the
       * outbox rather than sending real mail from a test run. That ordering is
       * the whole safety property of this branch.
       */
      const outbox = process.env.MAIL_OUTBOX_DIR;
      if (outbox) {
        logger.warn({ outbox }, 'Mail: writing to an outbox directory — nothing is being sent');
        return new FileTransport(outbox, logger);
      }

      if (!config.get('RESEND_API_KEY', { infer: true })) {
        logger.warn('Mail: no RESEND_API_KEY — messages are logged, not sent');
        return new LogTransport(logger);
      }

      /*
       * Said out loud at boot, because the alternative is what it took to find
       * out last time: sending a real email and reading the failure.
       *
       * `from` is in the line for a reason. On the packaged default —
       * `onboarding@resend.dev` — Resend delivers only to the address that owns
       * the API key and rejects everything else with a 403. That is a working
       * transport, a valid key, and mail that reaches nobody, and this line is
       * the only place it is visible without a delivery attempt.
       */
      logger.info({ from }, 'Mail: Resend');
      if (from.includes('resend.dev')) {
        logger.warn(
          { from },
          'Mail: MAIL_FROM is still the sandbox sender — Resend will only deliver to the API key owner. Verify a domain and set MAIL_FROM to use it.',
        );
      }
      return new ResendTransport(config, logger);
    },
  };
}

/** Convenience for injecting the transport into a service. */
export const InjectMailTransport = () => Inject(MAIL_TRANSPORT);
