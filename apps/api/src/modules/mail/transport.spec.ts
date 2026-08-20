import { LogTransport, mailTransportProvider, SmtpTransport } from './transport';

const logger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

type EnvValues = Partial<{
  RESEND_API_KEY: string;
  MAIL_FROM: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USER: string;
  SMTP_PASS: string;
}>;

function makeConfig(values: EnvValues) {
  const withDefaults: EnvValues = {
    MAIL_FROM: 'HRMS <onboarding@resend.dev>',
    SMTP_PORT: 465,
    ...values,
  };
  return {
    get: jest.fn((key: keyof EnvValues) => withDefaults[key]),
  };
}

describe('transport selection', () => {
  const provider = mailTransportProvider();

  function pick(values: EnvValues) {
    const config = makeConfig(values);
    const log = logger();
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    const transport = provider.useFactory(config as any, log as any);
    return { transport, log };
  }

  /*
   * The point of the fallback: an environment with no key must still boot and
   * still let someone walk the invite flow by reading the log. A transport
   * that threw on a missing key would make CI depend on a secret.
   */
  it('falls back to logging when nothing is configured', () => {
    expect(pick({}).transport).toBeInstanceOf(LogTransport);
  });

  it('uses Resend once a key is present', () => {
    const { transport } = pick({ RESEND_API_KEY: 're_test_key' });
    expect(transport).not.toBeInstanceOf(LogTransport);
    expect(transport).not.toBeInstanceOf(SmtpTransport);
  });

  /*
   * SMTP wins over Resend when both are set, so pointing at a Gmail App
   * Password never requires unsetting RESEND_API_KEY first.
   */
  it('prefers SMTP over Resend when both are configured', () => {
    const { transport, log } = pick({
      RESEND_API_KEY: 're_test_key',
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASS: 'app-password',
      MAIL_FROM: 'HRMS <someone@gmail.com>',
    });
    expect(transport).toBeInstanceOf(SmtpTransport);
    expect(log.info).toHaveBeenCalledWith(
      { host: 'smtp.gmail.com', from: 'HRMS <someone@gmail.com>' },
      expect.stringContaining('SMTP'),
    );
    expect(log.warn).not.toHaveBeenCalled();
  });

  /*
   * A host without credentials boots — the refusal belongs to the SMTP server
   * at send time — but says at startup why every send is about to fail.
   */
  it('warns when SMTP_HOST is set without credentials', () => {
    const { transport, log } = pick({ SMTP_HOST: 'smtp.gmail.com' });
    expect(transport).toBeInstanceOf(SmtpTransport);
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp.gmail.com' }),
      expect.stringContaining('SMTP_USER/SMTP_PASS'),
    );
  });

  /*
   * Said out loud at boot, because the alternative is what it took to find out
   * the last time somebody asked: send a real email and read the failure.
   */
  it('says which transport is live', () => {
    expect(pick({}).log.warn).toHaveBeenCalledWith(expect.stringContaining('no RESEND_API_KEY'));

    const { log } = pick({
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'HRMS <no-reply@acme.test>',
    });
    expect(log.info).toHaveBeenCalledWith(
      { from: 'HRMS <no-reply@acme.test>' },
      expect.stringContaining('Resend'),
    );
  });

  /*
   * A working key, a working transport, and mail that reaches exactly one
   * address. On the sandbox sender Resend refuses every recipient but the
   * account owner with a 403 — this warning is the only place that is visible
   * without attempting a delivery.
   */
  it('warns while the sandbox sender is still in use', () => {
    const sandbox = pick({ RESEND_API_KEY: 're_test_key' });
    expect(sandbox.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining('resend.dev') }),
      expect.stringContaining('sandbox sender'),
    );

    const verified = pick({
      RESEND_API_KEY: 're_test_key',
      MAIL_FROM: 'HRMS <no-reply@acme.test>',
    });
    expect(verified.log.warn).not.toHaveBeenCalled();
  });
});

describe('SmtpTransport', () => {
  const message = { to: 'a@b.com', subject: 'Hi', html: '<p>link</p>' };

  function makeTransport(sendMail: jest.Mock) {
    const config = makeConfig({
      SMTP_HOST: 'smtp.gmail.com',
      SMTP_USER: 'someone@gmail.com',
      SMTP_PASS: 'app-password',
      MAIL_FROM: 'HRMS <someone@gmail.com>',
    });
    const log = logger();
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    const transport = new SmtpTransport(config as any, log as any, { sendMail } as any);
    return { transport, log };
  }

  it('sends with the configured From and logs the message id', async () => {
    const sendMail = jest.fn().mockResolvedValue({ messageId: '<id-1>' });
    const { transport, log } = makeTransport(sendMail);

    await transport.send(message);

    expect(sendMail).toHaveBeenCalledWith({
      from: 'HRMS <someone@gmail.com>',
      to: 'a@b.com',
      subject: 'Hi',
      html: '<p>link</p>',
    });
    expect(log.info).toHaveBeenCalledWith(
      { to: 'a@b.com', id: '<id-1>' },
      expect.stringContaining('sent'),
    );
  });

  /*
   * Nodemailer rejects on failure — the opposite of the Resend SDK, which
   * resolves with { error }. The rejection must reach the caller untouched,
   * because "is a failed send fatal" is decided per call site (an invite is
   * not; see auth.service.ts) and a transport that swallowed it would turn
   * every mail outage into silent success.
   */
  it('propagates a transporter rejection to the caller', async () => {
    const sendMail = jest.fn().mockRejectedValue(new Error('535 bad credentials'));
    const { transport, log } = makeTransport(sendMail);

    await expect(transport.send(message)).rejects.toThrow('535 bad credentials');
    expect(log.info).not.toHaveBeenCalledWith(expect.anything(), expect.stringContaining('sent'));
  });
});

describe('LogTransport', () => {
  it('logs the whole message so the link is recoverable in dev', async () => {
    const log = logger();
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    const transport = new LogTransport(log as any);
    await transport.send({ to: 'a@b.com', subject: 'Hi', html: '<p>link</p>' });

    expect(log.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.com', html: '<p>link</p>' }),
      expect.stringContaining('not sent'),
    );
  });
});
