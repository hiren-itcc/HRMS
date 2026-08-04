import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActiveSession, authApi } from '@/features/auth/api';
import { render, screen, waitFor, within } from '@/test/render';
import SessionsPage from './page';

const replace = vi.fn();

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }));
vi.mock('@/components/session-provider', () => ({
  useSession: () => ({ user: { id: 'u1', email: 'a@b.co' } }),
}));
vi.mock('@/features/auth/api', () => ({
  authApi: { sessions: vi.fn(), revokeSession: vi.fn() },
}));

const CHROME_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

const session = (over: Partial<ActiveSession> = {}): ActiveSession => ({
  id: 's1',
  userAgent: CHROME_WIN,
  ip: '1.2.3.4',
  createdAt: '2026-08-01T09:00:00.000Z',
  expiresAt: '2026-09-01T09:00:00.000Z',
  isCurrent: false,
  ...over,
});

beforeEach(() => {
  replace.mockReset();
  vi.mocked(authApi.sessions).mockReset();
  vi.mocked(authApi.revokeSession).mockReset().mockResolvedValue(undefined);
});

describe('SessionsPage', () => {
  it('names the device from the user agent instead of dumping the raw string', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([
      session({ id: 's1', userAgent: CHROME_WIN }),
      session({ id: 's2', userAgent: SAFARI_IPHONE }),
    ]);
    render(<SessionsPage />);

    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('Safari on iOS')).toBeInTheDocument();
  });

  it('does not claim to know an unknown device', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([session({ userAgent: null })]);
    render(<SessionsPage />);
    expect(await screen.findByText('Unknown device')).toBeInTheDocument();
  });

  it('marks the device the list is being read on', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([
      session({ id: 's1', isCurrent: true }),
      session({ id: 's2', userAgent: SAFARI_IPHONE }),
    ]);
    render(<SessionsPage />);

    const current = (await screen.findByText('Chrome on Windows')).closest('li') as HTMLElement;
    expect(within(current).getByText('This device')).toBeInTheDocument();

    const other = screen.getByText('Safari on iOS').closest('li') as HTMLElement;
    expect(within(other).queryByText('This device')).not.toBeInTheDocument();
  });

  it('signs out another device without disturbing this one', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([session({ id: 's2', isCurrent: false })]);
    render(<SessionsPage />);

    await userEvent.click(
      await screen.findByRole('button', { name: /Sign out Chrome on Windows/i }),
    );

    // TanStack passes a context object as a second argument, so assert the id
    // rather than the whole call.
    await waitFor(() => expect(authApi.revokeSession).toHaveBeenCalled());
    expect(vi.mocked(authApi.revokeSession).mock.calls[0]?.[0]).toBe('s2');
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to sign-in after revoking your OWN session', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([session({ id: 's1', isCurrent: true })]);
    render(<SessionsPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Sign out this device/i }));

    /*
     * The API cleared the cookie, so this browser can no longer refresh.
     * Staying put works until the access token expires and then fails a refresh
     * the user cannot explain — so the redirect happens while it still makes
     * sense.
     */
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
  });

  it('shows an empty state rather than a bare card', async () => {
    vi.mocked(authApi.sessions).mockResolvedValue([]);
    render(<SessionsPage />);
    expect(await screen.findByText(/No active sessions/i)).toBeInTheDocument();
  });

  it('offers a retry when the list cannot load', async () => {
    vi.mocked(authApi.sessions).mockRejectedValue(new Error('boom'));
    render(<SessionsPage />);
    expect(await screen.findByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
