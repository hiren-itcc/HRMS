import { MailService } from './mail.service';

type Mock = jest.Mock;

function makeService(storedTemplate: unknown = null) {
  // biome-ignore lint/suspicious/noExplicitAny: structural test double
  const prisma: any = {
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Acme' }) },
    emailTemplate: { findUnique: jest.fn().mockResolvedValue(storedTemplate) },
  };
  const logger = { setContext: jest.fn(), warn: jest.fn() };
  const transport = { send: jest.fn().mockResolvedValue(undefined) };
  const service = new MailService(
    // biome-ignore lint/suspicious/noExplicitAny: structural test double
    logger as any,
    prisma,
    transport,
  );
  return { service, prisma, transport };
}

/**
 * `sendTemplate` is what every module other than auth sends through, so the
 * rule it enforces — which templates Settings is allowed to silence — is worth
 * pinning down. It is the difference between an organization declining
 * notification email and an organization accidentally locking everybody out of
 * password recovery.
 */
describe('sendTemplate', () => {
  it('renders the shipped copy and puts it on the wire', async () => {
    const { service, transport } = makeService();

    const sent = await service.sendTemplate('org1', 'notification_generic', 'ada@acme.test', {
      title: 'Your leave was approved',
      body: 'Casual leave, 1 Oct 2026 to 2 Oct 2026.',
      linkUrl: 'https://app.acme.test/leave',
    });

    expect(sent).toBe(true);
    const call = (transport.send as Mock).mock.calls[0][0];
    expect(call.to).toBe('ada@acme.test');
    expect(call.subject).toBe('Your leave was approved');
    expect(call.html).toContain('https://app.acme.test/leave');
    // Resolved here so no caller has to include the organization relation
    // just to send mail.
    expect(call.html).toContain('Acme');
  });

  it('prefers the organization’s own edit', async () => {
    const { service, transport } = makeService({
      subject: 'Edited — {{title}}',
      bodyHtml: '<p>Edited body</p>',
      isActive: true,
    });

    await service.sendTemplate('org1', 'notification_generic', 'ada@acme.test', { title: 'Hi' });

    expect((transport.send as Mock).mock.calls[0][0].subject).toBe('Edited — Hi');
  });

  /* Off means off — for the templates the catalogue marks `required: false`. */
  it('sends nothing when a notification template is switched off', async () => {
    const { service, transport } = makeService({
      subject: 's',
      bodyHtml: 'b',
      isActive: false,
    });

    const sent = await service.sendTemplate('org1', 'notification_generic', 'ada@acme.test', {});

    expect(sent).toBe(false);
    expect(transport.send).not.toHaveBeenCalled();
  });

  /*
   * The exception, and the reason `required` exists. A password reset nobody
   * receives is an account nobody can get back into, so switching it off in
   * Settings falls back to the shipped copy and still sends. Same for the
   * invite: a hire who never gets it cannot start.
   */
  it('still sends a required template that somebody switched off', async () => {
    const { service, transport } = makeService({
      subject: 'ignored',
      bodyHtml: 'ignored',
      isActive: false,
    });

    const sent = await service.sendTemplate('org1', 'password_reset', 'ada@acme.test', {
      resetUrl: 'https://app.acme.test/reset?token=x',
      email: 'ada@acme.test',
      expiryMinutes: 60,
    });

    expect(sent).toBe(true);
    // The shipped copy, not the disabled edit.
    expect((transport.send as Mock).mock.calls[0][0].html).toContain('Choose a new password');
  });

  it('refuses a key that is in no catalogue', async () => {
    const { service } = makeService();
    await expect(service.sendTemplate('org1', 'not_a_template', 'a@b.test')).rejects.toThrow(
      /Unknown email template/,
    );
  });

  /*
   * A reset requested for an address in no organization still has to send —
   * there is no org row to read a template or a name from.
   */
  it('works with no organization in hand', async () => {
    const { service, prisma, transport } = makeService();

    await service.sendTemplate(undefined, 'password_reset', 'stranger@nowhere.test', {
      resetUrl: 'https://app.acme.test/reset?token=x',
      email: 'stranger@nowhere.test',
      expiryMinutes: 60,
    });

    expect(prisma.emailTemplate.findUnique).not.toHaveBeenCalled();
    expect(transport.send).toHaveBeenCalled();
  });
});
