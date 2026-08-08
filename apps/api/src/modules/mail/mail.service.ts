import { emailTemplateDefault } from '@hrms/shared';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../database/prisma.service';
import { render, renderSubject, type TemplateVars } from './template-renderer';
import { MAIL_TRANSPORT, type MailTransport } from './transport';

/**
 * Mail port (ADR A5) — provider is config, callers depend on this interface.
 * This class owns *what* is sent: which template, rendered with which values.
 * Putting it on the wire is the transport's job (`transport.ts`).
 */
@Injectable()
export class MailService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
  ) {
    this.logger.setContext(MailService.name);
  }

  async sendPasswordReset(
    to: string,
    resetUrl: string,
    context?: { orgId?: string; orgName?: string; expiryMinutes?: number },
  ): Promise<void> {
    const vars: TemplateVars = {
      email: to,
      resetUrl,
      // Resolved here rather than at the call site so no caller has to
      // remember to include the organization relation just to send mail.
      orgName: context?.orgName ?? (await this.orgName(context?.orgId)),
      expiryMinutes: context?.expiryMinutes ?? 60,
    };
    // `password_reset` is `required`, so this is never null — the check is
    // what makes that guarantee visible rather than assumed.
    const composed = await this.compose(context?.orgId, 'password_reset', vars);
    if (composed) await this.transport.send({ to, subject: composed.subject, html: composed.html });
  }

  /**
   * The onboarding invite, sent to the hire's **personal** address — they have
   * no access to the work mailbox yet, which is the whole reason this exists.
   *
   * The mail states the work email as the login ID and carries a single-use
   * link; no password is ever put in it.
   */
  async sendOnboardingInvite(
    to: string,
    vars: {
      firstName: string;
      workEmail: string;
      inviteUrl: string;
      inviterName: string;
      expiryDays: number;
    },
    context: { orgId: string; orgName?: string },
  ): Promise<void> {
    // `employee_invite` is `required` too: an invite nobody receives is a hire
    // who cannot start.
    const composed = await this.compose(context.orgId, 'employee_invite', {
      ...vars,
      orgName: context.orgName ?? (await this.orgName(context.orgId)),
    });
    if (composed) await this.transport.send({ to, subject: composed.subject, html: composed.html });
  }

  /**
   * Send any template by key, resolving the organization's name for it.
   *
   * The two senders above are the special cases — they carry variables only
   * their own call sites can supply. Everything else wants exactly this.
   *
   * **Returns whether it sent.** A template the organization has switched off
   * is a decision, not a failure, and the caller may want to know the
   * difference between "delivered" and "deliberately not sent".
   */
  async sendTemplate(
    orgId: string | undefined,
    key: string,
    to: string,
    vars: TemplateVars = {},
  ): Promise<boolean> {
    const composed = await this.compose(orgId, key, {
      orgName: await this.orgName(orgId),
      ...vars,
    });
    if (!composed) return false;
    await this.transport.send({ to, subject: composed.subject, html: composed.html });
    return true;
  }

  private async orgName(orgId: string | undefined): Promise<string> {
    if (!orgId) return 'HRMS';
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    return org?.name ?? 'HRMS';
  }

  /**
   * Renders a template for an organization, falling back to the built-in copy
   * when the row is missing or there is no organization in hand (a reset
   * requested for an unknown email).
   *
   * **`null` means do not send.** A template switched off in Settings is only
   * silenced when the catalogue marks it `required: false` — notifications.
   * For the two the product depends on, a bad edit or a carelessly flicked
   * switch falls back to the shipped copy and the mail still goes: a password
   * reset nobody receives is an account nobody can get back into.
   */
  private async compose(
    orgId: string | undefined,
    key: string,
    vars: TemplateVars,
  ): Promise<{ subject: string; html: string } | null> {
    const fallback = emailTemplateDefault(key);
    if (!fallback) throw new Error(`Unknown email template: ${key}`);

    const stored = orgId
      ? await this.prisma.emailTemplate.findUnique({
          where: { organizationId_key: { organizationId: orgId, key } },
        })
      : null;

    // An edit decides; with no edit, the shipped copy's own flag does.
    const isOff = stored ? !stored.isActive : !fallback.active;
    if (isOff && !fallback.required) return null;

    const source = stored?.isActive ? stored : fallback;

    return {
      subject: renderSubject(source.subject, vars),
      html: render(source.bodyHtml, vars),
    };
  }
}
