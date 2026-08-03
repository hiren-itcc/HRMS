import { LogTransport, mailTransportProvider } from './transport';

const logger = () => ({ setContext: jest.fn(), info: jest.fn(), error: jest.fn() });

describe('transport selection', () => {
  const provider = mailTransportProvider();

  function pick(apiKey: string | undefined) {
    const config = {
      get: jest.fn((key: string) =>
        key === 'RESEND_API_KEY' ? apiKey : 'HRMS <onboarding@resend.dev>',
      ),
    };
    // biome-ignore lint/suspicious/noExplicitAny: structural test doubles
    return provider.useFactory(config as any, logger() as any);
  }

  /*
   * The point of the fallback: an environment with no key must still boot and
   * still let someone walk the invite flow by reading the log. A transport
   * that threw on a missing key would make CI depend on a secret.
   */
  it('falls back to logging when no API key is configured', () => {
    expect(pick(undefined)).toBeInstanceOf(LogTransport);
  });

  it('uses Resend once a key is present', () => {
    expect(pick('re_test_key')).not.toBeInstanceOf(LogTransport);
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
