import { LogTransport, mailTransportProvider } from './transport';

const logger = () => ({
  setContext: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
});

describe('transport selection', () => {
  const provider = mailTransportProvider();

  function pick(apiKey: string | undefined, from = 'HRMS <onboarding@resend.dev>') {
    const config = {
      get: jest.fn((key: string) => (key === 'RESEND_API_KEY' ? apiKey : from)),
    };
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
  it('falls back to logging when no API key is configured', () => {
    expect(pick(undefined).transport).toBeInstanceOf(LogTransport);
  });

  it('uses Resend once a key is present', () => {
    expect(pick('re_test_key').transport).not.toBeInstanceOf(LogTransport);
  });

  /*
   * Said out loud at boot, because the alternative is what it took to find out
   * the last time somebody asked: send a real email and read the failure.
   */
  it('says which transport is live', () => {
    expect(pick(undefined).log.warn).toHaveBeenCalledWith(
      expect.stringContaining('no RESEND_API_KEY'),
    );

    const { log } = pick('re_test_key', 'HRMS <no-reply@acme.test>');
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
    const sandbox = pick('re_test_key', 'HRMS <onboarding@resend.dev>');
    expect(sandbox.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ from: expect.stringContaining('resend.dev') }),
      expect.stringContaining('sandbox sender'),
    );

    const verified = pick('re_test_key', 'HRMS <no-reply@acme.test>');
    expect(verified.log.warn).not.toHaveBeenCalled();
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
