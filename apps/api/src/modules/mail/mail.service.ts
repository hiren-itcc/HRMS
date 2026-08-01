import { emailTemplateDefault } from '@hrms/shared';
import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../database/prisma.service';
import { render, renderSubject, type TemplateVars } from './template-renderer';

/**
 * Mail port (ADR A5) — provider is config, callers depend on this interface.
 * Until an SMTP provider is wired, the dev adapter logs the message so the
 * reset flow is fully exercisable locally.
 */
@Injectable()
export class MailService {
  constructor(
    private readonly logger: PinoLogger,
    private readonly prisma: PrismaService,
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
    const { subject, html } = await this.compose(context?.orgId, 'password_reset', vars);

    // SMTP adapter replaces this body; the signature is the contract.
    this.logger.info(
      { to, subject, html },
      'Password reset email (dev transport — message logged only)',
    );
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
   * Renders a template for an organization, falling back to the built-in
   * default when the row is missing, switched off, or there is no
   * organization in hand (a reset requested for an unknown email). A bad edit
   * in Settings must never be able to stop an email the product depends on.
   */
  private async compose(
    orgId: string | undefined,
    key: string,
    vars: TemplateVars,
  ): Promise<{ subject: string; html: string }> {
    const fallback = emailTemplateDefault(key);
    if (!fallback) throw new Error(`Unknown email template: ${key}`);

    const stored = orgId
      ? await this.prisma.emailTemplate.findUnique({
          where: { organizationId_key: { organizationId: orgId, key } },
        })
      : null;
    const source = stored?.isActive ? stored : fallback;

    return {
      subject: renderSubject(source.subject, vars),
      html: render(source.bodyHtml, vars),
    };
  }
}
